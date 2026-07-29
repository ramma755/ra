const path = require("path");
const axios = require("axios");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const XLSX = require("xlsx");
const env = require("../config/env");
const logger = require("./logger");
const { extractCatalogTextFromImage } = require("./aiParserService");

const normalizeMime = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const resolveMediaUrl = (media) => {
  const rawUrl =
    media?.url ||
    media?.link ||
    media?.downloadUrl ||
    media?.download_url ||
    media?.href ||
    "";
  if (!rawUrl) return "";
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith("/")) {
    const base = String(env.whatsappGateway.wahaBaseUrl || "").replace(/\/$/, "");
    if (!base) return rawUrl;
    return `${base}${rawUrl}`;
  }
  return rawUrl;
};

const buildMediaDownloadHeaders = () => {
  const headers = {};
  if (env.whatsappGateway.apiKey) {
    headers[env.whatsappGateway.wahaApiKeyHeader] = env.whatsappGateway.apiKey;
    headers.Authorization = `Bearer ${env.whatsappGateway.apiKey}`;
  }
  return headers;
};

const inferKind = ({ mimeType, fileName }) => {
  const mime = normalizeMime(mimeType);
  const extension = path.extname(String(fileName || "").toLowerCase());

  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || extension === ".pdf") return "pdf";
  if (
    mime.includes("wordprocessingml.document") ||
    mime === "application/msword" ||
    extension === ".docx" ||
    extension === ".doc"
  ) {
    return "word";
  }
  if (
    mime.includes("spreadsheetml.sheet") ||
    mime.includes("excel") ||
    extension === ".xlsx" ||
    extension === ".xls"
  ) {
    return "excel";
  }
  if (mime.includes("csv") || extension === ".csv") return "csv";
  if (mime.startsWith("text/") || extension === ".txt") return "text";
  return "unknown";
};

const extractExcelText = (buffer) => {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const lines = [];
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      blankrows: false,
      defval: "",
    });
    lines.push(`Sheet: ${sheetName}`);
    for (const row of rows) {
      const cells = Array.isArray(row) ? row.map((cell) => String(cell || "").trim()) : [];
      if (cells.length === 0) continue;
      const rowText = cells.filter(Boolean).join(", ");
      if (rowText) lines.push(rowText);
    }
  }
  return lines.join("\n").trim();
};

const downloadInboundMedia = async (media) => {
  const url = resolveMediaUrl(media);
  if (!url) {
    throw new Error("Uploaded media does not include a downloadable URL.");
  }
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    headers: buildMediaDownloadHeaders(),
    timeout: 30000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: (status) => status >= 200 && status < 400,
  });
  return {
    buffer: Buffer.from(response.data),
    mimeType: response.headers["content-type"] || media.mimeType || "",
    fileName: media.fileName || media.name || "",
    sourceUrl: url,
  };
};

const extractCatalogTextFromInboundMedia = async ({ media }) => {
  const downloaded = await downloadInboundMedia(media);
  const kind = inferKind({
    mimeType: downloaded.mimeType,
    fileName: downloaded.fileName,
  });

  let extractedText = "";
  if (kind === "pdf") {
    const parsed = await pdfParse(downloaded.buffer);
    extractedText = String(parsed.text || "");
  } else if (kind === "word") {
    const parsed = await mammoth.extractRawText({ buffer: downloaded.buffer });
    extractedText = String(parsed.value || "");
  } else if (kind === "excel") {
    extractedText = extractExcelText(downloaded.buffer);
  } else if (kind === "csv" || kind === "text") {
    extractedText = downloaded.buffer.toString("utf8");
  } else if (kind === "image") {
    extractedText = await extractCatalogTextFromImage({
      imageBuffer: downloaded.buffer,
      mimeType: downloaded.mimeType,
    });
  } else {
    throw new Error("Unsupported upload type. Use PDF, Word, Excel, CSV, text, or image.");
  }

  const cleaned = String(extractedText || "").trim();
  if (!cleaned) {
    throw new Error("No extractable catalog text found in uploaded file.");
  }

  logger.info("Catalog media extracted", {
    kind,
    mimeType: downloaded.mimeType,
    fileName: downloaded.fileName || null,
    sourceUrl: downloaded.sourceUrl,
    chars: cleaned.length,
  });

  return {
    extractedText: cleaned,
    mediaKind: kind,
    mimeType: downloaded.mimeType,
    fileName: downloaded.fileName || null,
  };
};

module.exports = {
  extractCatalogTextFromInboundMedia,
};
