const fs = require("fs");
const path = require("path");
const ffmpegPath = require("ffmpeg-static");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);
const { createCanvas, loadImage } = require("canvas");
const { getVideoDurationInSeconds } = require("get-video-duration");

const INPUT_DIR = "images";
const FRAME_DIR = "frames";
const OUTPUT_DIR = "output";
const TEMP_DIR = "temp_clips";
const FILE_LOG_DETAILS = "files.txt";
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 25;

const checkDirectory = () => {
  fs.existsSync(FILE_LOG_DETAILS) && fs.unlinkSync(FILE_LOG_DETAILS);
  [TEMP_DIR, OUTPUT_DIR, FRAME_DIR].forEach((e) => {
    fs.rmdirSync(`${e}/`, { recursive: true });
    fs.mkdirSync(`${e}/`);
  });
};

const wrapText = (ctx, text, maxWidth) => {
  const words = text.split(" ");
  const lines = [];
  let line = "";

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;

    if (testWidth > maxWidth && n > 0) {
      lines.push(line.trim());
      line = words[n] + " ";
    } else {
      line = testLine;
    }
  }

  lines.push(line.trim());
  return lines;
};

const generateFrames = async (slide, index) => {
  const duration = slide.duration || 4;
  const totalFrames = duration * FPS;
  const inputImagePath = path.join(INPUT_DIR, slide.image);
  const image = await loadImage(inputImagePath);

  const iw = image.width;
  const ih = image.height;
  const scale = Math.max(WIDTH / iw, HEIGHT / ih);
  const baseWidth = iw * scale;
  const baseHeight = ih * scale;

  // Prepare the full text and split it into letters
  const fullText = slide.text || "";
  const letters = fullText.split("");
  const totalLetters = letters.length;

  const revealFrames = Math.min(FPS * slide?.textDuration, totalFrames); // 2 sec reveal time

  for (let i = 0; i < totalFrames; i++) {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");

    let zoom = 1;
    if (slide.effect === "zoom-in") {
      zoom = 1 + 0.0015 * i;
    } else if (slide.effect === "zoom-out") {
      zoom = 1.15 - ((1.15 - 1.0) / totalFrames) * i;
    }

    const zoomedWidth = baseWidth * zoom;
    const zoomedHeight = baseHeight * zoom;
    const drawX = (WIDTH - zoomedWidth) / 2;
    const drawY = (HEIGHT - zoomedHeight) / 2;
    ctx.drawImage(image, drawX, drawY, zoomedWidth, zoomedHeight);

    // Figure out how many letters to show so far
    let lettersToShow;
    if (i < revealFrames) {
      lettersToShow = Math.floor((i / revealFrames) * totalLetters);
    } else {
      lettersToShow = totalLetters;
    }

    const textToShow = letters
      .slice(0, lettersToShow > 0 ? lettersToShow : 1)
      .join("");

    ctx.font = "36px Roboto";
    const maxTextWidth = WIDTH - 100;
    const lines = wrapText(ctx, textToShow, maxTextWidth);

    const lineHeight = 40;
    const paddingY = 8;
    const paddingX = 20;
    const gapFromBottom = 50;

    const boxHeight = lineHeight * lines.length + paddingY * 2;
    const widestLineWidth = Math.max(
      ...lines.map((l) => ctx.measureText(l).width)
    );
    const boxWidth = widestLineWidth + paddingX * 2;

    const boxX = (WIDTH - boxWidth) / 2;
    const boxY = HEIGHT - gapFromBottom - boxHeight;

    // Draw semi-transparent background box
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    ctx.fillStyle = "#fff";

    // Draw each letter with fade-in effect during reveal phase
    let letterIndex = 0;
    lines.forEach((line, idx) => {
      let textX = (WIDTH - ctx.measureText(line).width) / 2;
      let textY = boxY + paddingY + lineHeight * (idx + 1) - 10;

      for (let char of line) {
        // If the character just appeared within the last few frames, fade it in
        let alpha = 1;
        if (letterIndex === lettersToShow - 1 && i < revealFrames) {
          let frameIntoLetter =
            (i / revealFrames) * totalLetters - (lettersToShow - 1);
          alpha = Math.min(1, Math.max(0, frameIntoLetter * 5)); // fade speed
        }
        ctx.globalAlpha = alpha;
        ctx.fillText(char, textX, textY);
        ctx.globalAlpha = 1;
        textX += ctx.measureText(char).width;
        letterIndex++;
      }
    });

    const framePath = path.join(
      FRAME_DIR,
      `slide${index}_frame${i.toString().padStart(4, "0")}.png`
    );
    fs.writeFileSync(framePath, canvas.toBuffer("image/png"));
  }
};

const renderVideo = (
  slideIndex,
  frameCount,
  outputFilePath,
  audioPath = null
) => {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg()
      .input(path.join(FRAME_DIR, `slide${slideIndex}_frame%04d.png`))
      .inputOptions("-framerate", `${FPS}`)
      .outputOptions("-pix_fmt", "yuv420p")
      .videoCodec("libx264");

    if (audioPath) {
      cmd = cmd.input(audioPath).outputOptions("-shortest");
    }

    cmd
      .output(outputFilePath)
      .on("end", () => {
        console.log(`🎬 Slide ${slideIndex + 1} video rendered.`);
        resolve();
      })
      .on("error", (err) => {
        console.error("❌ Video render error:", err.message);
        reject(err);
      })
      .run();
  });
};

// ✅ New helper: normalize videos before merge
async function normalizeVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        `-vf scale=${WIDTH}:${HEIGHT},fps=${FPS},format=yuv420p`,
        "-c:v libx264",
        "-preset fast",
        "-crf 18",
        "-c:a aac",
        "-ar 44100"
      ])
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });
}

const createFinalVideo = async (audioPath = null) => {
  await checkDirectory();
  const slides = JSON.parse(fs.readFileSync("script.json", "utf-8"));

  // Step 1: Render and normalize individual slide videos
  for (let i = 0; i < slides.length; i++) {
    await generateFrames(slides[i], i);
    const frameCount = (slides[i].duration || 4) * FPS;
    const rawVideoPath = path.join(TEMP_DIR, `clip${i}_raw.mp4`);
    const normVideoPath = path.join(TEMP_DIR, `clip${i}.mp4`);
    await renderVideo(i, frameCount, rawVideoPath, null);
    await normalizeVideo(rawVideoPath, normVideoPath);
  }

  // Step 2: Normalize promo video
  const promoNormPath = path.join(TEMP_DIR, "promo_norm.mp4");
  await normalizeVideo("promoVideo/promo.mp4", promoNormPath);

  // Step 3: Merge with transitions
  return new Promise(async (resolve, reject) => {
    let cmd = ffmpeg();
    cmd = cmd.input(promoNormPath);
    slides.forEach((_, i) => {
      cmd = cmd.input(path.join(TEMP_DIR, `clip${i}.mp4`));
    });
    if (audioPath) cmd = cmd.input(audioPath);

    const transitions = ["fade", "fadeblack", "fadewhite", "slideleft", "slideright"];
    const transitionDuration = 1;
    let filterParts = [];
    const totalVideos = slides.length + 1;
    let currentLabel = "[0:v]";
    let accumulatedTime = await getVideoDuration(promoNormPath);

    for (let i = 1; i < totalVideos; i++) {
      const transitionType = transitions[Math.floor(Math.random() * transitions.length)];
      const offset = accumulatedTime - transitionDuration;

      filterParts.push(
        `${currentLabel}[${i}:v]xfade=transition=${transitionType}:duration=${transitionDuration}:offset=${offset}[v${i}]`
      );

      let clipDuration = i === 0
        ? await getVideoDuration(promoNormPath)
        : slides[i - 1].duration || 4;

      accumulatedTime += clipDuration - transitionDuration;
      currentLabel = `[v${i}]`;
    }

    let audioMap = "";
    if (audioPath) {
      audioMap = `;[${totalVideos}:a]atrim=0:${accumulatedTime},asetpts=PTS-STARTPTS[aout]`;
    }

    const filterComplex = filterParts.join("; ") + audioMap;
    let outputs = ["-map", currentLabel];
    if (audioPath) outputs.push("-map", "[aout]");

    cmd
      .complexFilter(filterComplex)
      .outputOptions(outputs)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions("-shortest")
      .output(path.join(OUTPUT_DIR, "final_video.mp4"))
      .on("end", () => {
        console.log("✅ Final video created without merge errors.");
        resolve();
      })
      .on("error", (err, stdout, stderr) => {
        console.error("❌ Merge error:", err.message);
        console.log("stderr:\n", stderr);
        reject(err);
      })
      .run();
  });
};


// ✅ Helper to get video duration without ffprobe
async function getVideoDuration(filePath) {
  try {
    return await getVideoDurationInSeconds(filePath);
  } catch (err) {
    console.error("Error getting duration:", err);
    return 0;
  }
}

createFinalVideo("audio/narration.mp3").catch(console.error);
