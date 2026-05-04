// ==============================
// NUVIO MOVIESDA PROVIDER
// ==============================

const MAIN_URL = "https://moviesda19.com";

const HEADERS = {
  "User-Agent": "Mozilla/5.0",
  "Referer": MAIN_URL + "/"
};

// ==============================
// UTILS
// ==============================

function fetchWithTimeout(url, options, timeout) {
  options = options || {};
  timeout = timeout || 10000;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject("Timeout"), timeout);

    fetch(url, options)
      .then(res => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function parseHTML(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

function normalizeTitle(title) {
  return title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "-");
}

// ==============================
// CORE SCRAPER
// ==============================

function fetchPage(url) {
  return fetchWithTimeout(url, { headers: HEADERS })
    .then(res => res.text());
}

function extractLinks(doc) {
  const anchors = Array.from(doc.querySelectorAll("a"));
  return anchors.map(a => ({
    href: a.href,
    text: (a.textContent || "").trim()
  }));
}

// ==============================
// STEP 1: FIND QUALITY LINKS
// ==============================

function getQualityLinks(url) {
  return fetchPage(url).then(html => {
    const doc = parseHTML(html);
    const links = extractLinks(doc);

    return links
      .filter(l => /360p|480p|720p|1080p/i.test(l.text))
      .map(l => ({
        url: l.href,
        quality: l.text.match(/360p|480p|720p|1080p/i)[0]
      }));
  });
}

// ==============================
// STEP 2: GET DOWNLOAD LINKS
// ==============================

function getDownloadLinks(url, quality) {
  return fetchPage(url).then(html => {
    const doc = parseHTML(html);
    const links = extractLinks(doc);

    return links
      .filter(l =>
        l.href &&
        (
          l.href.includes("download") ||
          l.text.toLowerCase().includes("download")
        )
      )
      .map(l => ({
        url: l.href,
        quality: quality
      }));
  });
}

// ==============================
// STEP 3: FINAL STREAM EXTRACTION
// ==============================

function extractFinalUrl(url) {
  return fetchPage(url).then(html => {
    const doc = parseHTML(html);

    // Try <video>
    const video = doc.querySelector("video source");
    if (video && video.src) return video.src;

    // Fallback regex
    const match = html.match(/https?:\/\/.*\.(mp4|m3u8)/);
    if (match) return match[0];

    return null;
  });
}

// ==============================
// MAIN FLOW
// ==============================

function scrapeMovie(title) {
  const slug = normalizeTitle(title);
  const url = `${MAIN_URL}/${slug}-tamil-movie/`;

  return getQualityLinks(url)
    .then(qLinks => {
      if (!qLinks.length) return [];

      return Promise.all(
        qLinks.map(q =>
          getDownloadLinks(q.url, q.quality)
        )
      ).then(results => results.flat());
    })
    .then(downloads => {
      return Promise.all(
        downloads.map(d =>
          extractFinalUrl(d.url).then(finalUrl => {
            if (!finalUrl) return null;

            return {
              name: "Moviesda",
              url: finalUrl,
              quality: d.quality
            };
          })
        )
      );
    })
    .then(streams => streams.filter(Boolean))
    .catch(() => []);
}

// ==============================
// NUVIO EXPORT
// ==============================

export default {
  name: "Moviesda",
  version: "1.0.0",

  async getStreams({ title, type }) {
    try {
      const streams = await scrapeMovie(title);

      return streams.map(s => ({
        title: `${title} (${s.quality})`,
        url: s.url,
        quality: s.quality,
        provider: "Moviesda"
      }));

    } catch (e) {
      return [];
    }
  }
};
