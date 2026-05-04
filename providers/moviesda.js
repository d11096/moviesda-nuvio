// Moviesda Scraper for Nuvio Local Scrapers
// React Native compatible version
// UPDATED: moviesda19.com support

const cheerio = require('cheerio-without-node-native');

// TMDB API Configuration
const TMDB_API_KEY = '1b3113663c9004682ed61086cf967c44';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Moviesda Configuration — UPDATED to moviesda19.com
let MAIN_URL = "https://moviesda19.com";

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Referer": `${MAIN_URL}/`,
};

// =================================================================================
// UTILITY FUNCTIONS
// =================================================================================

/**
 * Fetch with timeout to prevent hanging requests
 */
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error(`Request timeout after ${timeout}ms`);
        }
        throw error;
    }
}

/**
 * Normalizes title for comparison
 */
function normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Calculates similarity score between two titles
 */
function calculateTitleSimilarity(title1, title2) {
    const norm1 = normalizeTitle(title1);
    const norm2 = normalizeTitle(title2);

    if (norm1 === norm2) return 1.0;
    if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.9;

    const words1 = new Set(norm1.split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(norm2.split(/\s+/).filter(w => w.length > 2));

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
}

/**
 * De-obfuscates Packer-encoded string
 */
function unpack(p, a, c, k) {
    while (c--) {
        if (k[c]) {
            const placeholder = c.toString(a);
            p = p.replace(new RegExp('\\b' + placeholder + '\\b', 'g'), k[c]);
        }
    }
    return p;
}

/**
 * Finds the best title match from search results
 */
function findBestTitleMatch(mediaInfo, searchResults) {
    if (!searchResults || searchResults.length === 0) return null;

    const targetYear = mediaInfo.year ? parseInt(mediaInfo.year) : null;
    let bestMatch = null;
    let bestScore = 0;

    for (const result of searchResults) {
        let score = calculateTitleSimilarity(mediaInfo.title, result.title);

        if (targetYear) {
            if (result.title.includes(targetYear.toString())) {
                score += 0.3;
            } else if (result.title.includes((targetYear + 1).toString()) ||
                result.title.includes((targetYear - 1).toString())) {
                score += 0.1;
            }
        }

        if (score > bestScore) {
            bestScore = score;
            bestMatch = result;
        }
    }

    if (bestMatch && bestScore > 0.4) {
        console.log(`[Moviesda] Best match: "${bestMatch.title}" (score: ${bestScore.toFixed(2)})`);
        return bestMatch;
    }

    return null;
}

/**
 * Formats a rich multi-line title for a stream
 */
function formatStreamTitle(mediaInfo, stream) {
    const quality = stream.quality || "Unknown";
    const title = mediaInfo.title || "Unknown";
    const year = mediaInfo.year || "";

    let size = "";
    const sizeMatch = stream.text ? stream.text.match(/(\d+(?:\.\d+)?\s*(?:GB|MB))/i) : null;
    if (sizeMatch) size = sizeMatch[1];

    let type = "";
    const searchString = ((stream.text || "") + " " + (stream.url || "")).toLowerCase();

    if (searchString.includes('bluray') || searchString.includes('brrip')) type = "BluRay";
    else if (searchString.includes('web-dl')) type = "WEB-DL";
    else if (searchString.includes('webrip')) type = "WEBRip";
    else if (searchString.includes('hdrip')) type = "HDRip";
    else if (searchString.includes('dvdrip')) type = "DVDRip";
    else if (searchString.includes('bdrip')) type = "BDRip";
    else if (searchString.includes('hdtv')) type = "HDTV";

    const typeLine = type ? `📹: ${type}\n` : "";
    const sizeLine = size ? `💾: ${size} | 🚜: moviesda\n` : "";
    const yearStr = year && year !== "N/A" ? ` ${year}` : "";

    const langMarkers = {
        'TAMIL': /tamil/i,
        'HINDI': /hindi/i,
        'TELUGU': /telugu/i,
        'MALAYALAM': /malayalam/i,
        'KANNADA': /kannada/i,
        'ENGLISH': /english|eng/i,
        'MULTI AUDIO': /multi/i
    };

    let language = "TAMIL";
    for (const [name, regex] of Object.entries(langMarkers)) {
        if (regex.test(searchString)) {
            language = name;
            break;
        }
    }

    return `Moviesda (Instant) (${quality})
${typeLine}📼: ${title}${yearStr} ${quality}
${sizeLine}🌐: ${language}`;
}

// =================================================================================
// CORE FUNCTIONS
// =================================================================================

/**
 * Fetches metadata from TMDB
 */
async function getTMDBDetails(tmdbId, mediaType) {
    const type = mediaType === 'movie' ? 'movie' : 'tv';
    const url = `${TMDB_BASE_URL}/${type}/${tmdbId}?api_key=${TMDB_API_KEY}`;

    try {
        const response = await fetchWithTimeout(url, {}, 8000);
        const data = await response.json();

        const info = {
            title: data.title || data.name,
            year: (data.release_date || data.first_air_date || "").split("-")[0]
        };
        console.log(`[Moviesda] TMDB Info: "${info.title}" (${info.year || 'N/A'})`);
        return info;
    } catch (error) {
        console.error("[Moviesda] Error fetching TMDB metadata:", error.message);
        throw error;
    }
}

/**
 * Searches TMDB by movie title to get year
 */
async function searchTMDBByTitle(title, mediaType) {
    const type = mediaType === 'movie' ? 'movie' : 'tv';
    const url = `${TMDB_BASE_URL}/search/${type}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`;

    try {
        console.log(`[Moviesda] Searching TMDB for: "${title}"`);
        const response = await fetchWithTimeout(url, {}, 8000);
        const data = await response.json();

        if (data.results && data.results.length > 0) {
            const firstResult = data.results[0];
            const info = {
                title: firstResult.title || firstResult.name,
                year: (firstResult.release_date || firstResult.first_air_date || "").split("-")[0]
            };
            console.log(`[Moviesda] TMDB Search Result: "${info.title}" (${info.year || 'N/A'})`);
            return info;
        }

        console.log(`[Moviesda] No TMDB results found for "${title}"`);
        return null;
    } catch (error) {
        console.error("[Moviesda] Error searching TMDB:", error.message);
        return null;
    }
}

/**
 * Searches Moviesda by browsing category pages
 * UPDATED: moviesda19.com category URL pattern
 */
async function search(query, year = null) {
    console.log(`[Moviesda] Searching for: "${query}" (year: ${year || 'any'})`);

    try {
        const results = [];
        const categoriesToCheck = [];

        if (year) {
            // UPDATED: new category URL patterns for moviesda19.com
            categoriesToCheck.push(`${MAIN_URL}/tamil-${year}-movies/`);
            categoriesToCheck.push(`${MAIN_URL}/category/tamil-${year}/`);
            categoriesToCheck.push(`${MAIN_URL}/?year=${year}`);
        } else {
            const currentYear = new Date().getFullYear();
            for (let y = currentYear; y >= currentYear - 2; y--) {
                categoriesToCheck.push(`${MAIN_URL}/tamil-${y}-movies/`);
                categoriesToCheck.push(`${MAIN_URL}/category/tamil-${y}/`);
            }
        }

        console.log(`[Moviesda] Checking ${categoriesToCheck.length} category pages`);

        for (const categoryUrl of categoriesToCheck) {
            try {
                const response = await fetchWithTimeout(categoryUrl, { headers: HEADERS }, 8000);
                if (!response.ok) continue;
                const html = await response.text();
                const $ = cheerio.load(html);

                // UPDATED: broader selector to catch new site patterns
                $('a').each((i, el) => {
                    const href = $(el).attr('href');
                    const text = $(el).text().trim();

                    if (!href || href === '#' || text.length < 3) return;

                    // Match movie links — must contain year or "tamil-movie"
                    if (!href.includes('-tamil-movie') && !href.includes('-movie/')) return;

                    // Skip navigation/category links
                    if (href.includes('/tamil-movies/') || href.includes('/category/')) return;

                    const match = text.match(/^(.+?)\s*(?:\((\d{4})\))?$/);
                    if (match) {
                        const title = match[1].trim();
                        const movieYear = match[2] || null;
                        const fullUrl = href.startsWith('http') ? href : `${MAIN_URL}${href}`;

                        results.push({
                            title: text,
                            cleanTitle: title,
                            year: movieYear,
                            href: fullUrl
                        });
                    }
                });

            } catch (error) {
                console.error(`[Moviesda] Error browsing ${categoryUrl}: ${error.message}`);
            }
        }

        console.log(`[Moviesda] Found ${results.length} total movies in categories`);
        return results;

    } catch (error) {
        console.error("[Moviesda] Search error:", error.message);
        return [];
    }
}

/**
 * Browses a specific year category
 */
async function browseCategory(year) {
    const url = `${MAIN_URL}/tamil-${year}-movies/`;
    console.log(`[Moviesda] Browsing category: ${url}`);

    try {
        const response = await fetchWithTimeout(url, { headers: HEADERS }, 8000);
        const html = await response.text();
        const $ = cheerio.load(html);
        const results = [];

        $("article.post, .post-item, .movie-item").each((i, el) => {
            const titleEl = $(el).find("h2.entry-title a, h2 a, .entry-title a");
            const title = titleEl.text().trim();
            const href = titleEl.attr("href");

            if (title && href) {
                const qualityMatch = title.match(/\b(360p|480p|720p|1080p|4K)\b/i);
                const quality = qualityMatch ? qualityMatch[0] : "Unknown";
                results.push({ title, href, quality });
            }
        });

        console.log(`[Moviesda] Found ${results.length} movies in category`);
        return results;
    } catch (error) {
        console.error("[Moviesda] Category browse error:", error.message);
        return [];
    }
}

// =================================================================================
// HOST EXTRACTORS
// =================================================================================

/**
 * Generic extractor that looks for common video source patterns
 */
async function extractFromGenericEmbed(embedUrl, hostName) {
    try {
        const embedBase = new URL(embedUrl).origin;
        const response = await fetchWithTimeout(embedUrl, {
            headers: {
                ...HEADERS,
                'Referer': MAIN_URL
            }
        }, 5000);
        let html = await response.text();

        const packerMatch = html.match(/eval\(function\(p,a,c,k,e,d\)\{.*?\}\s*\((.*)\)\s*\)/s);
        if (packerMatch) {
            console.log(`[Moviesda] Detected Packer obfuscation on ${hostName}, unpacking...`);
            const rawArgs = packerMatch[1].trim();
            const pMatch = rawArgs.match(/^'(.*)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split\(/s);

            if (pMatch) {
                const unpacked = unpack(pMatch[1], parseInt(pMatch[2]), parseInt(pMatch[3]), pMatch[4].split('|'));
                html += "\n" + unpacked;
            }
        }

        const patterns = [
            /["']hls[2-4]["']\s*:\s*["']([^"']+)["']/gi,
            /sources\s*:\s*\[\s*{\s*file\s*:\s*["']([^"']+)["']/gi,
            /https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi,
            /["'](\/[^\s"']+\.m3u8[^\s"']*)["']/gi,
            /https?:\/\/[^\s"']+\.mp4[^\s"']*/gi,
            /(?:source|file|src)\s*[:=]\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/gi,
        ];

        const allFoundUrls = [];
        for (const pattern of patterns) {
            const matches = html.match(pattern);
            if (matches && matches.length > 0) {
                for (let match of matches) {
                    let videoUrl = match;

                    const kvMatch = match.match(/["']:[ ]*["']([^"']+)["']/);
                    if (kvMatch) {
                        videoUrl = kvMatch[1];
                    } else {
                        const quoteMatch = match.match(/["']([^"']+)["']/);
                        if (quoteMatch) videoUrl = quoteMatch[1];
                    }

                    const absUrlMatch = videoUrl.match(/https?:\/\/[^\s"']+/);
                    if (absUrlMatch) videoUrl = absUrlMatch[0];

                    videoUrl = videoUrl.replace(/[\\"'\)\]]+$/, '');

                    if (!videoUrl || videoUrl.length < 5 ||
                        videoUrl.includes('google.com') ||
                        videoUrl.includes('youtube.com')) {
                        continue;
                    }

                    if (videoUrl.startsWith('/') && !videoUrl.startsWith('//')) {
                        videoUrl = embedBase + videoUrl;
                    }

                    allFoundUrls.push(videoUrl);
                }
            }
        }

        if (allFoundUrls.length > 0) {
            allFoundUrls.sort((a, b) => {
                const isM3U8A = a.toLowerCase().includes('.m3u8');
                const isM3U8B = b.toLowerCase().includes('.m3u8');
                if (isM3U8A !== isM3U8B) return isM3U8B ? 1 : -1;
                return a.length - b.length;
            });

            const bestUrl = allFoundUrls[0];
            console.log(`[Moviesda] Found direct URL from ${hostName}: ${bestUrl}`);
            return bestUrl;
        }

        console.log(`[Moviesda] No direct URL found in ${hostName}, skipping`);
        return null;

    } catch (error) {
        console.error(`[Moviesda] Error extracting from ${hostName}: ${error.message}`);
        return null;
    }
}

/**
 * Attempts to extract direct stream URL from various embed hosts
 */
async function extractDirectStream(embedUrl) {
    try {
        console.log(`[Moviesda] Extracting from embed: ${embedUrl}`);
        const url = new URL(embedUrl);
        const hostname = url.hostname.toLowerCase();

        if (hostname.includes('onestream.today')) {
            return await extractFromOnestream(embedUrl);
        }

        return await extractFromGenericEmbed(embedUrl, hostname);

    } catch (error) {
        console.error(`[Moviesda] Extraction error: ${error.message}`);
        return null;
    }
}

/**
 * Extracts direct stream URL from onestream.watch embed pages
 */
async function extractFromOnestream(embedUrl) {
    console.log(`[Moviesda] Extracting from onestream.today: ${embedUrl}`);

    try {
        const response = await fetchWithTimeout(embedUrl, {
            headers: {
                ...HEADERS,
                'Referer': MAIN_URL
            }
        }, 8000);
        const html = await response.text();
        const $ = cheerio.load(html);

        const videoSources = [];
        $('video source').each((i, el) => {
            const src = $(el).attr('src');
            const type = $(el).attr('type');
            if (src) {
                videoSources.push({ src, type });
            }
        });

        if (videoSources.length > 0) {
            const directUrl = videoSources[0].src;
            console.log(`[Moviesda] Found direct URL from onestream: ${directUrl}`);
            return directUrl;
        }

        const m3u8Match = html.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/i);
        if (m3u8Match) {
            console.log(`[Moviesda] Found m3u8 URL: ${m3u8Match[0]}`);
            return m3u8Match[0];
        }

        const mp4Match = html.match(/https?:\/\/[^\s"']+\.mp4[^\s"']*/i);
        if (mp4Match) {
            console.log(`[Moviesda] Found mp4 URL: ${mp4Match[0]}`);
            return mp4Match[0];
        }

        console.log(`[Moviesda] No direct URL found in onestream page`);
        return null;

    } catch (error) {
        console.error(`[Moviesda] Onestream extraction error: ${error.message}`);
        return null;
    }
}

// =================================================================================
// PAGE PARSERS — UPDATED for moviesda19.com
// =================================================================================

/**
 * Parses movie detail page for download/stream links
 * UPDATED: handles both old "-original-movie" and new "-original-hd" patterns
 */
async function parseMoviePage(url) {
    console.log(`[Moviesda] Parsing movie page: ${url}`);

    try {
        const response = await fetchWithTimeout(url, { headers: HEADERS }, 8000);
        const html = await response.text();
        const $ = cheerio.load(html);
        const streams = [];

        // UPDATED: check for both old and new "original" page patterns
        const originalLink = $(
            'a[href*="-original-hd"], a[href*="-original-movie"], a[href*="original"]'
        ).first();

        if (originalLink.length > 0) {
            const originalUrl = originalLink.attr('href');
            const fullOriginalUrl = originalUrl.startsWith('http')
                ? originalUrl
                : `${MAIN_URL}${originalUrl}`;
            console.log(`[Moviesda] Found original page link: ${fullOriginalUrl}`);
            return await parseOriginalPage(fullOriginalUrl);
        }

        // Look for quality-specific links (360p, 480p, 720p, 1080p, 4K)
        const qualityLinks = [];
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();

            if (href && text.match(/\b(360p|480p|720p|1080p|4K)\b/i)) {
                const qualityMatch = text.match(/\b(360p|480p|720p|1080p|4K)\b/i);
                const quality = qualityMatch ? qualityMatch[0] : "Unknown";
                const fullUrl = href.startsWith('http') ? href : `${MAIN_URL}${href}`;
                qualityLinks.push({ url: fullUrl, quality, text });
            }
        });

        if (qualityLinks.length > 0) {
            console.log(`[Moviesda] Found ${qualityLinks.length} quality pages`);
            for (const qualityLink of qualityLinks) {
                const qualityStreams = await parseQualityPage(qualityLink.url, qualityLink.quality);
                qualityStreams.forEach(s => {
                    if (!s.text) s.text = qualityLink.text || "";
                });
                streams.push(...qualityStreams);
            }
            return streams;
        }

        // UPDATED: broader download link detection for moviesda19.com
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();

            if (href && (
                href.includes('/download/') ||
                href.includes('gdrive') ||
                href.includes('drive.google') ||
                href.includes('pixeldrain') ||
                href.includes('hubcloud') ||
                text.toLowerCase().includes('download')
            )) {
                const fullUrl = href.startsWith('http') ? href : `${MAIN_URL}${href}`;
                streams.push({
                    url: fullUrl,
                    quality: "Unknown",
                    type: "download",
                    text: text
                });
            }
        });

        console.log(`[Moviesda] Found ${streams.length} streams on page`);
        return streams;

    } catch (error) {
        console.error("[Moviesda] Movie page parse error:", error.message);
        return [];
    }
}

/**
 * Parses the "original" page that contains links to quality-specific pages
 * UPDATED: handles new moviesda19.com quality link patterns
 */
async function parseOriginalPage(url) {
    console.log(`[Moviesda] Parsing original page: ${url}`);

    try {
        const response = await fetchWithTimeout(url, { headers: HEADERS }, 8000);
        const html = await response.text();
        const $ = cheerio.load(html);
        const streams = [];

        $('a').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();

            // UPDATED: match quality links more broadly
            if (href && text.match(/\b(360p|480p|720p|1080p|4K)\b/i)) {
                const qualityMatch = text.match(/\b(360p|480p|720p|1080p|4K)\b/i);
                const quality = qualityMatch ? qualityMatch[0] : "Unknown";
                const fullUrl = href.startsWith('http') ? href : `${MAIN_URL}${href}`;

                streams.push({
                    url: fullUrl,
                    quality: quality,
                    type: "quality_page",
                    text: text
                });
            }
        });

        console.log(`[Moviesda] Found ${streams.length} quality pages on original page`);

        const finalStreams = [];
        for (const stream of streams) {
            const qualityStreams = await parseQualityPage(stream.url, stream.quality);
            finalStreams.push(...qualityStreams);
        }

        return finalStreams;

    } catch (error) {
        console.error("[Moviesda] Original page parse error:", error.message);
        return [];
    }
}

/**
 * Parses a quality-specific page to extract download links
 * UPDATED: broader link detection for moviesda19.com
 */
async function parseQualityPage(url, quality) {
    console.log(`[Moviesda] Parsing quality page (${quality}): ${url}`);

    try {
        const response = await fetchWithTimeout(url, { headers: HEADERS }, 8000);
        const html = await response.text();
        const $ = cheerio.load(html);
        const streams = [];

        $('a').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();

            // UPDATED: catch more download link patterns used by moviesda19.com
            if (href && (
                href.includes('/download/') ||
                href.includes('moviespage.xyz') ||
                href.includes('hubdrive') ||
                href.includes('gdrive') ||
                href.includes('pixeldrain') ||
                href.includes('hubcloud') ||
                href.includes('fastdl') ||
                text.toLowerCase().includes('download now') ||
                text.toLowerCase().includes('fast download')
            )) {
                const fullUrl = href.startsWith('http') ? href : `${MAIN_URL}${href}`;
                streams.push({
                    url: fullUrl,
                    quality: quality,
                    type: "download",
                    text: text
                });
            }
        });

        console.log(`[Moviesda] Found ${streams.length} download links for ${quality}`);
        return streams;

    } catch (error) {
        console.error(`[Moviesda] Quality page parse error (${quality}): ${error.message}`);
        return [];
    }
}

/**
 * Extracts the final stream URL from a moviesda download page
 * UPDATED: handles moviesda19.com download page structure
 */
async function extractFinalDownloadUrl(downloadPageUrl) {
    console.log(`[Moviesda] Extracting final URL from: ${downloadPageUrl}`);

    try {
        const response = await fetchWithTimeout(downloadPageUrl, { headers: HEADERS }, 8000);
        const html = await response.text();
        const $ = cheerio.load(html);

        const downloadLinks = [];
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim().toLowerCase();

            // UPDATED: exclude moviesda19.com instead of moviesda15.com
            if (href &&
                !href.includes('moviesda19.com') &&
                !href.includes('/tamil-movies/') &&
                !href.startsWith('#') &&
                (text.includes('download') || text.includes('server') ||
                 text.includes('fast') || text.includes('direct'))) {

                const fullUrl = href.startsWith('http') ? href : `https:${href}`;
                downloadLinks.push(fullUrl);
            }
        });

        if (downloadLinks.length > 0) {
            const downloadUrl = downloadLinks[0];
            console.log(`[Moviesda] Found download URL: ${downloadUrl}`);

            // Convert moviespage.xyz download link to onestream.watch
            if (downloadUrl.includes('download.moviespage.xyz/download/file/')) {
                const fileIdMatch = downloadUrl.match(/\/file\/(\d+)/);
                if (fileIdMatch) {
                    const fileId = fileIdMatch[1];
                    const streamUrl = `https://play.onestream.today/stream/page/${fileId}`;
                    console.log(`[Moviesda] Converted to onestream URL: ${streamUrl}`);
                    return { url: streamUrl, needsExtraction: true };
                }
            }

            return { url: downloadUrl, needsExtraction: false };
        }

        console.log(`[Moviesda] No final download URL found on page`);
        return null;

    } catch (error) {
        console.error(`[Moviesda] Error extracting final URL: ${error.message}`);
        return null;
    }
}

// =================================================================================
// MAIN FUNCTION
// =================================================================================

/**
 * Main function for Nuvio integration
 * UPDATED: moviesda19.com direct URL construction
 */
async function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
    console.log(`[Moviesda] Processing ${mediaType} ${tmdbId}`);

    try {
        let mediaInfo;

        const isNumericId = /^\d+$/.test(tmdbId);
        if (isNumericId) {
            try {
                mediaInfo = await getTMDBDetails(tmdbId, mediaType);
            } catch (error) {
                console.log(`[Moviesda] TMDB fetch failed, using "${tmdbId}" as search query`);
                mediaInfo = { title: tmdbId, year: null };
            }
        } else {
            console.log(`[Moviesda] Using "${tmdbId}" as search query`);
            try {
                const tmdbResult = await searchTMDBByTitle(tmdbId, mediaType);
                if (tmdbResult && tmdbResult.year) {
                    mediaInfo = tmdbResult;
                } else {
                    mediaInfo = { title: tmdbId, year: null };
                }
            } catch (error) {
                console.log(`[Moviesda] TMDB search failed: ${error.message}`);
                mediaInfo = { title: tmdbId, year: null };
            }
        }

        console.log(`[Moviesda] Looking for: "${mediaInfo.title}" (${mediaInfo.year || 'N/A'})`);

        // Try category page search first
        let searchResults = await search(mediaInfo.title, mediaInfo.year);
        const bestMatch = findBestTitleMatch(mediaInfo, searchResults);

        if (!bestMatch) {
            console.warn("[Moviesda] No matching title found in category pages");

            // UPDATED: direct URL fallback for moviesda19.com
            const currentYear = new Date().getFullYear();
            const yearsToTry = mediaInfo.year ?
                [mediaInfo.year, currentYear, currentYear - 1] :
                [currentYear, currentYear - 1, currentYear + 1,
                    currentYear - 2, currentYear - 3, currentYear - 4];

            for (const year of yearsToTry) {
                const slug = mediaInfo.title.toLowerCase()
                    .replace(/[^a-z0-9\s]/g, '')
                    .replace(/\s+/g, '-');

                // UPDATED: try multiple URL patterns for moviesda19.com
                const urlsToTry = [
                    `${MAIN_URL}/${slug}-${year}-tamil-movie/`,
                    `${MAIN_URL}/${slug}-${year}-hindi-movie/`,
                    `${MAIN_URL}/${slug}-${year}-telugu-movie/`,
                    `${MAIN_URL}/${slug}-tamil-movie/`,
                ];

                for (const directUrl of urlsToTry) {
                    console.log(`[Moviesda] Trying direct URL: ${directUrl}`);

                    try {
                        const response = await fetchWithTimeout(directUrl, { headers: HEADERS }, 5000);
                        if (response.ok) {
                            const html = await response.text();
                            if (html.includes('entry-title') || html.includes('movie')) {
                                console.log(`[Moviesda] ✓ Direct URL found: ${directUrl}`);
                                const rawStreams = await parseMoviePage(directUrl);

                                if (rawStreams.length > 0) {
                                    const limitedStreams = rawStreams.slice(0, 5);
                                    const finalStreams = await processStreams(limitedStreams, mediaInfo);
                                    if (finalStreams.length > 0) {
                                        console.log(`[Moviesda] Successfully extracted ${finalStreams.length} streams`);
                                        return finalStreams;
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        console.log(`[Moviesda] Direct URL failed: ${error.message}`);
                    }
                }
            }

            console.warn("[Moviesda] No results found via category search or direct URL");
            return [];
        }

        console.log(`[Moviesda] Processing match: ${bestMatch.title}`);

        const rawStreams = await parseMoviePage(bestMatch.href);

        if (rawStreams.length === 0) {
            console.warn("[Moviesda] No streams found on movie page");
            return [];
        }

        const limitedStreams = rawStreams.slice(0, 5);
        if (rawStreams.length > 5) {
            console.log(`[Moviesda] Limiting to first 5 streams out of ${rawStreams.length}`);
        }

        const finalStreams = await processStreams(limitedStreams, mediaInfo);
        console.log(`[Moviesda] Successfully extracted ${finalStreams.length} streams`);
        return finalStreams;

    } catch (error) {
        console.error("[Moviesda] getStreams failed:", error.message);
        return [];
    }
}

/**
 * NEW HELPER: processes raw streams into final playable stream objects
 * Extracted as separate function to avoid code duplication
 */
async function processStreams(limitedStreams, mediaInfo) {
    const finalStreams = [];

    for (const stream of limitedStreams) {
        let finalUrl = stream.url;

        if (stream.type === "download") {
            try {
                const result = await Promise.race([
                    extractFinalDownloadUrl(stream.url),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Extraction timeout')), 5000)
                    )
                ]);

                if (!result) continue;

                if (result.needsExtraction) {
                    try {
                        const directUrl = await Promise.race([
                            extractFromOnestream(result.url),
                            new Promise((_, reject) =>
                                setTimeout(() => reject(new Error('Onestream extraction timeout')), 5000)
                            )
                        ]);
                        if (!directUrl) continue;
                        finalUrl = directUrl;
                    } catch (error) {
                        console.error(`[Moviesda] Onestream extraction failed: ${error.message}`);
                        continue;
                    }
                } else {
                    finalUrl = result.url;
                }
            } catch (error) {
                console.error(`[Moviesda] Download URL extraction failed: ${error.message}`);
                continue;
            }
        } else if (stream.type === "embed") {
            try {
                const extractedUrl = await Promise.race([
                    extractDirectStream(stream.url),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Extraction timeout')), 5000)
                    )
                ]);

                if (!extractedUrl) continue;
                finalUrl = extractedUrl;
            } catch (error) {
                console.error(`[Moviesda] Embed extraction failed: ${error.message}`);
                continue;
            }
        }

        finalStreams.push({
            name: "Moviesda",
            title: formatStreamTitle(mediaInfo, stream),
            url: finalUrl,
            quality: stream.quality,
            headers: {
                "Referer": MAIN_URL,
                "User-Agent": HEADERS["User-Agent"]
            },
            provider: 'Moviesda'
        });
    }

    return finalStreams;
}

// Export the main function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = { getStreams };
}

// =================================================================================
// TEST BLOCK — remove before production
// =================================================================================
//async function test() {
//    console.log("=== Starting Moviesda Test ===\n");
//    try {
 //       const streams = await getStreams("Jailer", "movie");
  //      if (streams.length === 0) {
    //        console.log("❌ No streams found — site structure may have changed");
      //  } else {
        //    console.log(`✅ Found ${streams.length} stream(s):\n`);
          //  streams.forEach((s, i) => {
            //    console.log(`--- Stream ${i + 1} ---`);
              //  console.log(`Quality : ${s.quality}`);
                //console.log(`URL     : ${s.url}`);
                //console.log(`Title   : ${s.title}`);
                //console.log("");
            //});
       // }
    //} catch (err) {
     //   console.error("❌ Test failed with error:", err.message);
    //}
//}

//test();
