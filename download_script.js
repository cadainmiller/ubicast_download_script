#!/usr/bin/env node

const axios = require("axios")
const fs = require("fs")
const path = require("path")
const unidecode = require("unidecode")
const readline = require("readline")
const minimist = require("minimist")

// Terminal colors
const RED = "\x1b[91m"
const GREEN = "\x1b[92m"
const YELLOW = "\x1b[93m"
const BLUE = "\x1b[94m"
const DEFAULT = "\x1b[0m"

const OBJECT_TYPES = { v: "video", l: "live", p: "photos", c: "channel" }

// Mock MediaServerClient for Testing Purposes
class MediaServerClient {
  constructor(configPath) {
    this.config = configPath
    this.conf = { TIMEOUT: 120 }
  }

  async api(endpoint, options = {}) {
    console.log(`Mock API called: ${endpoint}`)
    // Provide mock responses based on the endpoint
    if (endpoint === "channels/get/") {
      return { info: { oid: options.params.oid, title: "Mock Channel" } }
    }
    if (endpoint === "channels/content/") {
      return {
        channels: [],
        videos: [{ oid: "v123", title: "Test Video" }],
        photos_groups: [],
      }
    }
    if (endpoint === "medias/resources-list/") {
      return {
        resources: [
          {
            file_size: 1024,
            format: "mp4",
            file: "http://example.com/test.mp4",
          },
        ],
      }
    }
    if (endpoint === "download/") {
      return { url: "http://example.com/test.mp4" }
    }
    return {}
  }

  async check_server() {
    console.log("Server check: Success")
  }
}

// Helper functions
function getRepr(item) {
  return `${OBJECT_TYPES[item.oid[0]]} ${item.oid} "${item.title.slice(0, 40)}${
    item.title.length > 40 ? "..." : ""
  }"`
}

function getPrefix(item) {
  return `${unidecode(item.title.slice(0, 57).trim()).replace("/", "|")} - ${
    item.oid
  }`
}

async function getDownloadLink(msc, item) {
  if (item.oid[0] !== "v") return null

  const resources = (
    await msc.api("medias/resources-list/", { params: { oid: item.oid } })
  ).resources
  resources.sort((a, b) => b.file_size - a.file_size)
  if (resources.length === 0) return null

  const bestQuality = resources.find((r) => r.format !== "m3u8")
  if (!bestQuality) return null

  const response = await msc.api("download/", {
    method: "get",
    params: { oid: item.oid, url: bestQuality.file, redirect: "no" },
  })

  return { filename: item.title, download_link: response.url }
}

async function processChannel(msc, channelInfo, downloadLinks) {
  console.log(
    `${BLUE}Processing channel: ${channelInfo.oid} - ${channelInfo.title}${DEFAULT}`
  )

  const channelItems = await msc.api("channels/content/", {
    method: "get",
    params: { parent_oid: channelInfo.oid, content: "cvp" },
  })

  for (const entry of channelItems.channels || []) {
    await processChannel(msc, entry, downloadLinks)
  }

  const items = (channelItems.videos || []).concat(
    channelItems.photos_groups || []
  )
  for (let index = 0; index < items.length; index++) {
    try {
      console.log(
        `${YELLOW}Processing item ${index + 1}/${items.length}: ${getRepr(
          items[index]
        )}${DEFAULT}`
      )
      const linkInfo = await getDownloadLink(msc, items[index])
      if (linkInfo) downloadLinks.push(linkInfo)
      await new Promise((resolve) => setTimeout(resolve, 500))
    } catch (error) {
      console.error(`${RED}Error retrieving link: ${error}${DEFAULT}`)
    }
  }
}

async function outputDownloadLinks(msc, channelOid) {
  console.log("Starting to gather download links...")
  const downloadLinks = []

  try {
    const channelParent = await msc.api("channels/get/", {
      method: "get",
      params: { oid: channelOid },
    })
    await processChannel(msc, channelParent.info, downloadLinks)
  } catch (error) {
    console.error(
      `Please enter a valid channel oid or check access permissions. Error: ${error}`
    )
    return 1
  }

  const filePath = path.join(process.cwd(), "download.json")
  fs.writeFileSync(filePath, JSON.stringify(downloadLinks, null, 2))
  console.log(
    `${GREEN}Download links gathered successfully and saved to ${filePath}.${DEFAULT}`
  )
  return 0
}

// Helper function to process downloads in chunks of a specified size, starting at a specific chunk
async function downloadInChunks(files, chunkSize, startChunk = 0) {
  const totalChunks = Math.ceil(files.length / chunkSize)

  for (let i = startChunk * chunkSize; i < files.length; i += chunkSize) {
    const chunkNumber = Math.floor(i / chunkSize) + 1
    const chunk = files.slice(i, i + chunkSize)

    console.log(`Downloading chunk ${chunkNumber} of ${totalChunks}...`)

    await Promise.all(
      chunk.map((media) => downloadVideo(media.download_link, media.filename))
    )
  }
}

// Function to download individual video (Mock implementation for testing)
async function downloadVideo(url, filename) {
  console.log(`Downloading ${filename} from ${url}`)
  // Add actual download logic here if needed
}

// Main script logic
;(async () => {
  const args = minimist(process.argv.slice(2))
  if (!args.conf || !args.channel) {
    console.error(
      "Missing required arguments. Use --conf for configuration path and --channel for channel oid."
    )
    process.exit(1)
  }

  const configPath = args.conf
  if (!configPath.startsWith("unix:") && !fs.existsSync(configPath)) {
    console.error("Invalid path for configuration file.")
    process.exit(1)
  }

  const msc = new MediaServerClient(configPath)
  await msc.check_server()
  msc.conf["TIMEOUT"] = Math.max(120, msc.conf["TIMEOUT"])

  const rc = await outputDownloadLinks(msc, args.channel)
  process.exit(rc)
})()
