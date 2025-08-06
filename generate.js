const fs = require("fs");
const path = require("path");
const ffmpegPath = require("ffmpeg-static");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);

const { createCanvas, loadImage } = require("canvas");

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

const generateFrames = async (slide, index) => {
  const duration = slide.duration || 4;
  const totalFrames = duration * FPS;
  const inputImagePath = path.join(INPUT_DIR, slide.image);
  const image = await loadImage(inputImagePath);

  // Calculate base scale to fit image in 1280x720
  
  // const iw = image.width;
  // const ih = image.height;
  // const imageAspect = iw / ih;
  // const canvasAspect = WIDTH / HEIGHT;

  // let baseWidth, baseHeight;

  // if (imageAspect > canvasAspect) {
  //   // Image is wider than canvas
  //   baseWidth = WIDTH;
  //   baseHeight = WIDTH / imageAspect;
  // } else {
  //   // Image is taller than canvas
  //   baseHeight = HEIGHT;
  //   baseWidth = HEIGHT * imageAspect;
  // }

  // const offsetX = (WIDTH - baseWidth) / 2;
  // const offsetY = (HEIGHT - baseHeight) / 2;


  // Scale image to COVER the canvas (may crop)
  const iw = image.width;
  const ih = image.height;
  const scale = Math.max(WIDTH / iw, HEIGHT / ih); // cover logic

  const baseWidth = iw * scale;
  const baseHeight = ih * scale;

  // Below code are same for fit image and COVER the canvas

  for (let i = 0; i < totalFrames; i++) {
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d");

    // Zoom relative to scaled image
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

    // Draw text box
    const text = slide.text || "";
    ctx.font = "36px Roboto";
    const textWidth = ctx.measureText(text).width;

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    const boxX = (WIDTH - textWidth) / 2 - 20;
    const boxY = HEIGHT - 100;
    const boxHeight = 50;
    ctx.fillRect(boxX, boxY, textWidth + 40, boxHeight);

    ctx.fillStyle = "white";
    ctx.fillText(text, (WIDTH - textWidth) / 2, HEIGHT - 65);

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

const createFinalVideo = async (audioPath = null) => {
  await checkDirectory();
  const slides = JSON.parse(fs.readFileSync("script.json", "utf-8"));

  for (let i = 0; i < slides.length; i++) {
    await generateFrames(slides[i], i);
    const frameCount = (slides[i].duration || 4) * FPS;
    const videoPath = path.join(TEMP_DIR, `clip${i}.mp4`);
    await renderVideo(i, frameCount, videoPath, null);
  }
  const clipFiles = slides
    .map((_, i) => `file '${path.posix.join(TEMP_DIR, `clip${i}.mp4`)}'`)
    .join("\n");

  fs.writeFileSync(FILE_LOG_DETAILS, clipFiles);

  return new Promise((resolve, reject) => {
    let cmd = ffmpeg()
      .input(FILE_LOG_DETAILS)
      .inputOptions(["-f", "concat", "-safe", "0"])
      .outputOptions(["-c:v", "libx264"]);

    if (audioPath) {
      cmd = cmd.input(audioPath).outputOptions("-shortest");
    }

    cmd
      .save(path.join(OUTPUT_DIR, "final_video.mp4"))
      .on("end", () => {
        console.log("\n✅ Final video created at output/final_video.mp4");
        resolve();
      })
      .on("error", (err) => {
        console.error("❌ Final video creation failed:", err.message);
        reject(err);
      });
  });
};

createFinalVideo("audio/narration.mp3").catch(console.error);
