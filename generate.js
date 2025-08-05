const fs = require("fs");
const path = require("path");
const ffmpegPath = require("ffmpeg-static");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);
const tf = require("@tensorflow/tfjs");
const cocoSsd = require("@tensorflow-models/coco-ssd");
const { createCanvas, loadImage } = require("canvas");

const OUTPUT_DIR = "output";
const TEMP_DIR = "temp_clips";

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

const removeCreateFolder = () => {
  fs.rmdirSync(`${TEMP_DIR}/`, { recursive: true });
  fs.rmdirSync(`${OUTPUT_DIR}/`, { recursive: true });
  fs.mkdirSync(`${TEMP_DIR}/`);
  fs.mkdirSync(`${OUTPUT_DIR}/`);
};

const detectFocus = async (imagePath, label) => {
  const image = await loadImage(imagePath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, image.width, image.height);

  const input = tf.browser.fromPixels(canvas);
  const model = await cocoSsd.load();
  const predictions = await model.detect(input);
  input.dispose();

  const match = predictions.find((p) =>
    p.class.toLowerCase().includes(label.toLowerCase())
  );
  if (!match) return null;

  const [x, y, w, h] = match.bbox;
  return {
    cx: x + w / 2,
    cy: y + h / 2,
  };
};

const processSlide = async (slide, index) => {
  const input = slide.image;
  const duration = slide.duration || 4;
  const output = path.join(TEMP_DIR, `clip${index}.mp4`);
  const size = "1280x720";

  let zoomExpr = "zoom='1+0.002*on'";
  let xExpr = "x='iw/2-(iw/zoom/2)'";
  let yExpr = "y='ih/2-(ih/zoom/2)'";

  if (slide.effect === "zoom-out") {
    const totalFrames = duration * 25;
    const startZoom = 1.3;
    const endZoom = 1.0;
    const rate = (startZoom - endZoom) / totalFrames;
    zoomExpr = `zoom='max(${endZoom}, ${startZoom.toFixed(3)} - ${rate.toFixed(5)}*on)'`;
  }

  if (slide.effect === "focus" && slide.focus) {
    const coords = await detectFocus(input, slide.focus);
    if (coords) {
      xExpr = `x='${coords.cx}-(iw/zoom/2)'`;
      yExpr = `y='${coords.cy}-(ih/zoom/2)'`;
    }
  }

  const totalFrames = duration * 25;
  const zoompanFilter = `zoompan=${zoomExpr}:${xExpr}:${yExpr}:d=${totalFrames}:s=${size}:fps=25`;

  return new Promise((resolve, reject) => {
    const command = ffmpeg(input)
      .inputOptions("-loop 1")
      .complexFilter(
        [
          `[0:v]${zoompanFilter}[z];[z]drawtext=text='${slide.text}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=h-60:box=1:boxcolor=black@0.5:boxborderw=10[out]`,
        ],
        "out"
      )
      .outputOptions([`-t ${duration}`, "-pix_fmt yuv420p"])
      .save(output)
      .on("end", () => {
        console.log(`✅ Slide ${index + 1} rendered.`);
        resolve();
      })
      .on("error", (err) => {
        console.error(`❌ Slide ${index + 1} failed:`, err);
        reject(err);
      });
  });
};

const createFinalVideo = async (audioPath = null) => {
  await removeCreateFolder();
  const slides = JSON.parse(fs.readFileSync("script.json", "utf-8"));
  const videoListPath = path.join(TEMP_DIR, "files.txt");

  for (let i = 0; i < slides.length; i++) {
    await processSlide(slides[i], i);
  }

  const clipFiles = slides.map((_, i) => `file 'clip${i}.mp4'`).join("\n");
  fs.writeFileSync(videoListPath, clipFiles);

  return new Promise((resolve, reject) => {
    let cmd = ffmpeg()
      .input(videoListPath)
      .inputOptions(["-f", "concat", "-safe", "0"])
      .outputOptions(["-c:v", "libx264"]);

    if (audioPath) {
      cmd = cmd.input(audioPath).outputOptions("-shortest");
    }

    cmd
      .save(path.join(OUTPUT_DIR, "final_video.mp4"))
      .on("end", () => {
        console.log("\n🎬 Video created at output/final_video.mp4");
        resolve();
      })
      .on("error", reject);
  });
};

createFinalVideo("audio/narration.mp3").catch(console.error);
