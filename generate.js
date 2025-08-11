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

  const fullText = slide.text || "";
  const letters = fullText.split("");
  const totalLetters = letters.length;
  const revealFrames = Math.min(FPS * slide?.textDuration, totalFrames);

  for (let i = 0; i < totalFrames; i++) {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");

    // Zoom effect
    let zoom = 1;
    if (slide?.effect === "zoom-in") {
      zoom = 1 + 0.0015 * i;
    } else if (slide?.effect === "zoom-out") {
      zoom = 1.15 - ((1.15 - 1.0) / totalFrames) * i;
    }

    const zoomedWidth = baseWidth * zoom;
    const zoomedHeight = baseHeight * zoom;
    const drawX = (WIDTH - zoomedWidth) / 2;
    const drawY = (HEIGHT - zoomedHeight) / 2;
    ctx.drawImage(image, drawX, drawY, zoomedWidth, zoomedHeight);

    // Letter reveal
    let lettersToShow =
      i < revealFrames
        ? Math.floor((i / revealFrames) * totalLetters)
        : totalLetters;

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

    // Background box
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    ctx.fillStyle = "#fff";
    let letterIndex = 0;

    lines.forEach((line, idx) => {
      let textX = (WIDTH - ctx.measureText(line).width) / 2;
      let textY = boxY + paddingY + lineHeight * (idx + 1) - 10;

      for (let char of line) {
        let alpha = 1;
        if (letterIndex === lettersToShow - 1 && i < revealFrames) {
          let frameIntoLetter =
            (i / revealFrames) * totalLetters - (lettersToShow - 1);
          alpha = Math.min(1, Math.max(0, frameIntoLetter * 5));
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
const normalizeVideo = async (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        `-vf scale=${WIDTH}:${HEIGHT},fps=${FPS},format=yuv420p`,
        "-c:v libx264",
        "-preset fast",
        "-crf 18",
        "-c:a aac",
        "-ar 44100",
      ])
      .on("end", resolve)
      .on("error", reject)
      .save(outputPath);
  });
};

const createFinalVideo = async (audioPath = null) => {
  console.time("videoMakingTime");
  await checkDirectory();
  const slides = JSON.parse(fs.readFileSync("script.json", "utf-8"));

  // Step 1: Render & normalize individual slide videos
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
  await new Promise(async (resolve, reject) => {
    let cmd = ffmpeg();
    cmd = cmd.input(promoNormPath);

    slides.forEach((_, i) => {
      cmd = cmd.input(path.join(TEMP_DIR, `clip${i}.mp4`));
    });

    if (audioPath) cmd = cmd.input(audioPath);

    const transitions = [
      "fade",
      "fadeblack",
      "fadewhite",
      "slideleft",
      "slideright",
    ];
    const transitionDuration = 1;
    const firstTransitionDuration = 2;
    const totalVideos = slides.length + 1;
    const firstTransitionType = "fade";

    let videoParts = [];
    let currentLabel = "[0:v]";
    let accumulatedTime = await getVideoDuration(promoNormPath);

    for (let i = 1; i < totalVideos; i++) {
      const transitionType =
        i < 3
          ? firstTransitionType
          : transitions[Math.floor(Math.random() * transitions.length)];

      const currentTransitionDuration =
        i === 1 ? firstTransitionDuration : transitionDuration;

      const offset = accumulatedTime - currentTransitionDuration;

      videoParts.push(
        `${currentLabel}[${i}:v]xfade=transition=${transitionType}:duration=${currentTransitionDuration}:offset=${offset}[v${i}]`
      );

      let clipDuration = slides[i - 1]?.duration || 4;
      accumulatedTime += clipDuration - currentTransitionDuration;
      currentLabel = `[v${i}]`;
    }

    let audioParts = [];
    const promoDur = await getVideoDuration(promoNormPath);
    audioParts.push(`[0:a]atrim=0:${promoDur},asetpts=PTS-STARTPTS[aud0]`);

    if (audioPath) {
      let audioStart = 0;
      for (let i = 0; i < slides.length; i++) {
        let dur = slides[i].duration || 4;
        audioParts.push(
          `[${totalVideos}:a]atrim=${audioStart}:${
            audioStart + dur
          },asetpts=PTS-STARTPTS[aud${i + 1}]`
        );
        audioStart += dur;
      }
    }

    const audioConcatInputs = audioParts
      .map((_, idx) => `[aud${idx}]`)
      .join("");
    const audioChain = `${audioParts.join(
      "; "
    )}; ${audioConcatInputs}concat=n=${audioParts.length}:v=0:a=1[aout]`;

    const filterComplex = [...videoParts, audioChain].join("; ");

    let outputs = ["-map", currentLabel];
    if (audioPath) outputs.push("-map", "[aout]");

    cmd
      .complexFilter(filterComplex)
      .outputOptions(outputs)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions("-shortest")
      .output(path.join(OUTPUT_DIR, "final_video_no_logo.mp4")) // save without logo
      .on("end", resolve)
      .on("error", reject)
      .run();
  });

  // Step 4: Add Logo Overlay
  const logoPath = path.join("impImg", "logo.png"); // Transparent PNG logo
  const logoSize = 120; // px
  const logoMarginRight = 20; // from right edge
  const logoMarginTop = 0; // from top edge

  await new Promise((resolve, reject) => {
    ffmpeg(path.join(OUTPUT_DIR, "final_video_no_logo.mp4"))
      .input(logoPath)
      .complexFilter([
        `[1:v]scale=${logoSize}:-1[logo]; [0:v][logo]overlay=W-w-${logoMarginRight}:${logoMarginTop}`,
      ])
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions("-shortest")
      .output(path.join(OUTPUT_DIR, "final_video.mp4"))
      .on("end", () => {
        console.log("✅ Final video created with logo overlay.");
        console.timeEnd("videoMakingTime");
        resolve();
      })
      .on("error", reject)
      .run();
  });
};

// ✅ Helper to get video duration without ffprobe
const getVideoDuration = async (filePath) => {
  try {
    return await getVideoDurationInSeconds(filePath);
  } catch (err) {
    console.error("Error getting duration:", err);
    return 0;
  }
};

createFinalVideo("audio/audioFile.mp3").catch(console.error);
