import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync, spawnSync } from "child_process";

const SOURCE_URL = "https://www.youtube.com/playlist?list=PLvAyFccyE6iOFgCAT4RaYxz2JUpNWwk9u";
const DATA_FILE = join(process.cwd(), "data", "processed.json");
const DOWNLOADS_DIR = join(process.cwd(), "downloads");

if (!existsSync(join(process.cwd(), "data"))) mkdirSync(join(process.cwd(), "data"));
if (!existsSync(DOWNLOADS_DIR)) mkdirSync(DOWNLOADS_DIR);

function getProcessedVideos() {
  if (!existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DATA_FILE, "utf-8"));
  } catch (e) {
    return [];
  }
}

function saveProcessedVideo(videoId) {
  const processed = getProcessedVideos();
  processed.push(videoId);
  writeFileSync(DATA_FILE, JSON.stringify(processed, null, 2));
}

function hasInternet() {
  try {
    execSync("/sbin/ping -c 1 google.com", { stdio: "ignore" });
    return true;
  } catch (e) {
    return false;
  }
}

async function notifySlack(message) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  console.log("Sending Slack notification...");
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    console.log("Slack notification sent.");
  } catch (error) {
    console.error("Failed to send Slack notification:", error.message);
  }
}

function generateReadme() {
  const processed = getProcessedVideos();
  if (processed.length === 0) return;

  const videoData = [];
  processed.forEach(videoId => {
    const metadataPath = join(DOWNLOADS_DIR, videoId, "metadata.json");
    if (existsSync(metadataPath)) {
      videoData.push(JSON.parse(readFileSync(metadataPath, "utf-8")));
    }
  });

  videoData.sort((a, b) => b.uploadDate.localeCompare(a.uploadDate));

  let content = "# YouTube Video Gallery\n\n";
  content += "This gallery is automatically updated with the latest videos from the playlist.\n\n";
  content += "| Thumbnail | Title | Upload Date | Link |\n";
  content += "| :--- | :--- | :--- | :--- |\n";

  videoData.forEach(metadata => {
    const videoId = metadata.videoId;
    const thumbPath = `downloads/${videoId}/thumbnail.jpg`;
    const videoUrl = metadata.videoUrl;
    const title = metadata.title;
    const date = metadata.uploadDate;
    const formattedDate = `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`;
    
    content += `| [![${title}](${thumbPath})](${videoUrl}) | ${title} | ${formattedDate} | [Watch](${videoUrl}) |\n`;
  });

  writeFileSync(join(process.cwd(), "README.md"), content);
  console.log("README.md updated (sorted by latest upload).");
}

function gitSync() {
  console.log("Syncing with GitHub...");
  try {
    execSync("/usr/bin/git add .", { stdio: "inherit" });
    const status = execSync("/usr/bin/git status --porcelain").toString().trim();
    if (status) {
      execSync('/usr/bin/git commit -m "Auto-update: New videos and gallery updated"', { stdio: "inherit" });
      execSync("/usr/bin/git push", { stdio: "inherit" });
      console.log("Changes pushed to GitHub successfully.");
    } else {
      console.log("No changes to commit.");
    }
  } catch (error) {
    console.error("Failed to sync with GitHub:", error.message);
  }
}

async function checkChannel() {
  if (!hasInternet()) {
    console.error("No internet connection. Skipping check.");
    return;
  }
  console.log(`Checking source: ${SOURCE_URL}`);
  
  let newVideoTitles = [];
  try {
    const result = spawnSync("/opt/homebrew/bin/yt-dlp", [
      "--ignore-errors",
      "--print", "%(id)s|%(title)s|%(thumbnail)s|%(upload_date)s",
      "--playlist-items", "1-10",
      SOURCE_URL
    ], { encoding: "utf-8" });

    if (result.error) {
      console.error("Error executing yt-dlp:", result.error.message);
      return;
    }

    if (result.stderr && result.stderr.includes("ERROR")) {
      console.error("yt-dlp stderr:", result.stderr);
    }

    const output = result.stdout ? result.stdout.trim().split("\n") : [];
    
    if (output.length === 0 || !output[0]) {
      console.log("No videos found or error occurred. Output was empty.");
      return;
    }

    const processed = getProcessedVideos();
    let hasNew = false;

    output.forEach(line => {
      const parts = line.split("|");
      if (parts.length < 4) return;

      const videoId = parts[0].trim();
      const title = parts[1].trim();
      const thumbnailUrl = parts[2].trim();
      const uploadDate = parts[3].trim();
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

      if (videoId === "NA" || !videoId) return;

      if (!processed.includes(videoId)) {
        console.log(`New video found: ${title}`);
        hasNew = true;
        newVideoTitles.push(title);
        
        const videoFolder = join(DOWNLOADS_DIR, videoId);
        if (!existsSync(videoFolder)) mkdirSync(videoFolder);

        const metadata = { title, videoUrl, videoId, uploadDate, dateAdded: new Date().toISOString() };
        writeFileSync(join(videoFolder, "metadata.json"), JSON.stringify(metadata, null, 2));

        if (thumbnailUrl && thumbnailUrl !== "NA") {
          console.log(`Downloading thumbnail for ${videoId}...`);
          try {
            execSync(`/usr/bin/curl -L -s -o "${join(videoFolder, "thumbnail.jpg")}" "${thumbnailUrl}"`);
          } catch (e) {
            console.error(`Failed to download thumbnail via curl: ${e.message}`);
          }
        } else {
          console.log(`Thumbnail URL not found for ${videoId}. Skipping thumbnail download.`);
        }

        saveProcessedVideo(videoId);
        console.log(`Saved ${title} to ${videoFolder}`);
      }
    });
    
    if (hasNew || !existsSync(join(process.cwd(), "README.md"))) {
      generateReadme();
      gitSync();
    }
    
    const notificationMessage = hasNew 
      ? `✅ *Videoupdater Job Complete*\nNew videos added:\n${newVideoTitles.map(t => `• ${t}`).join("\n")}`
      : "✅ *Videoupdater Job Complete*\nNo new videos found.";

    await notifySlack(notificationMessage);
    console.log("Check complete.");
  } catch (error) {
    console.error("Error checking source:", error.message);
    await notifySlack(`❌ *Videoupdater Job Failed*\nError: ${error.message}`);
  }
}

checkChannel();
