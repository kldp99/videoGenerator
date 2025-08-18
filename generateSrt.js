const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const ffmpeg = require("fluent-ffmpeg");

ffmpeg.setFfmpegPath(ffmpegPath);

const INPUT_VIDEO = "input.mp4";             // your input video
const AUDIO_FILE = "temp_audio.wav";         // temporary audio file
const SUB_FILE = "temp_audio.srt";           // subtitles file

// 1. Extract audio from video
function extractAudio() {
  return new Promise((resolve, reject) => {
    console.log("🎵 Extracting audio...");
    ffmpeg(INPUT_VIDEO)
      .output(AUDIO_FILE)
      .audioCodec("pcm_s16le")
      .audioFrequency(16000)   // 16kHz recommended for Whisper
      .audioChannels(1)        // mono
      .noVideo()
      .on("end", () => {
        console.log("✅ Audio extracted:", AUDIO_FILE);
        resolve();
      })
      .on("error", reject)
      .run();
  });
}

// 2. Generate subtitles using local Whisper (via Python)
function generateSubtitles() {
  return new Promise((resolve, reject) => {
    console.log("📝 Running Whisper locally...");
    // Use python -m whisper so PATH issues don't matter
    exec(`py -m whisper ${AUDIO_FILE} --model small --language en --output_format srt`, (err, stdout, stderr) => {

      if (err) {
        console.error("❌ Whisper failed:", stderr);
        return reject(err);
      }
      console.log("✅ Subtitles generated:", SUB_FILE);
      resolve();
    });
  });
}

// 4. Pipeline
(async () => {
  try {
    await extractAudio();
    await generateSubtitles();
    console.log("🎉 Done!");
  } catch (err) {
    console.error("❌ Error:", err);
  }
})();
