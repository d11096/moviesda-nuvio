// Moviesda Scraper for Nuvio Mobile
// UPDATED: moviesda19.com + Promise-based (no async/await)

var cheerio = require('cheerio-without-node-native');

var TMDB_API_KEY = '1b3113663c9004682ed61086cf967c44';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';
var MAIN_URL = 'https://moviesda19.com';

var HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': MAIN_URL + '/'
};

// =================================================================================
// UTILITY FUNCTIONS
// =================================================================================

function fetchWithTimeout(url, options, timeout) {
    options = options || {};
    timeout = timeout || 10000;
    return new Promise(function(resolve, reject) {
        var timer = setTimeout(function() {
            reject(new Error('Request timeout after ' + timeout + 'ms'));
        }, timeout);
        fetch(url, options).then(function(response) {
            clearTimeout(timer);
            resolve(response);
        }).catch(function(err) {
            clearTimeout(timer);
            reject(err);
        });
    });
}

function normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function calculateTitleSimilarity(title1, title2) {
    var norm1 = normalizeTitle(title1);
    var norm2 = normalizeTitle(title2);
    if (norm1 === norm2) return 1.0;
    if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.9;
    var words1 = norm1.split(/\s+/).filter(function(w) { return w.length > 2; });
    var words2 = norm2.split(/\s+/).filter(function(w) { return w.length > 2; });
    var set1 = new Set(words1);
    var set2 = new Set(words2);
    if (set1.size === 0 || set2.size === 0) return 0;
    var intersection = words1.filter(function(w) { return set2.has(w); });
    var unionSize = new Set(words1.concat(words2)).size;
    return intersection.length / unionSize;
}

function findBestTitleMatch(mediaInfo, searchResults) {
    if (!searchResults || searchResults.length === 0) return null;
    var targetYear = mediaInfo.year ? parseInt(mediaInfo.year) : null;
    var bestMatch = null;
    var bestScore = 0;
    for (var i = 0; i < searchResults.length; i++) {
        var result = searchResults[i];
        var score = calculateTitleSimilarity(mediaInfo.title, result.title);
        if (targetYear) {
            if (result.title.includes(String(targetYear))) score += 0.3;
            else if (result.title.includes(String(targetYear + 1)) || result.title.includes(String(targetYear - 1))) score += 0.1;
        }
        if (score > bestScore) {
            bestScore = score;
            bestMatch = result;
        }
    }
    if (bestMatch && bestScore > 0.4) {
        console.log('[Moviesda] Best match: "' + bestMatch.title + '" (score: ' + bestScore.toFixed(2) + ')');
        return bestMatch;
    }
    return null;
}

function sanitizeStreamUrl(url) {
    if (!url) return url;
    try {
        var parts = url.split('?');
        if (parts.length < 2) return url;
        var base = parts[0];
        var queryString = parts.slice(1).join('?');
        var encodedQuery = queryString.split('&').map(function(part) {
            var eqIndex = part.indexOf('=');
            if (eqIndex === -1) return part;
            var key = part.substring(0, eqIndex);
            var value = part.substring(eqIndex + 1).replace(/ /g, '%20');
            return key + '=' + value;
        }).join('&');
        return base + '?' + encodedQuery;
    } catch(e) {
        return url;
    }
}

function formatStreamTitle(mediaInfo, stream) {
    var quality = stream.quality || 'Unknown';
    var title = mediaInfo.title || 'Unknown';
    var year = mediaInfo.year || '';
    var size = '';
    var sizeMatch = stream.text ? stream.text.match(/(\d+(?:\.\d+)?\s*(?:GB|MB))/i) : null;
    if (sizeMatch) size = sizeMatch[1];
    var type = '';
    var searchString = ((stream.text || '') + ' ' + (stream.url || '')).toLowerCase();
    if (searchString.includes('bluray') || searchString.includes('brrip')) type = 'BluRay';
    else if (searchString.includes('web-dl')) type = 'WEB-DL';
    else if (searchString.includes('webrip')) type = 'WEBRip';
    else if (searchString.includes('hdrip')) type = 'HDRip';
    else if (searchString.includes('dvdrip')) type = 'DVDRip';
    var typeLine = type ? ('📹: ' + type + '\n') : '';
    var sizeLine = size ? ('💾: ' + size + ' | 🚜: moviesda\n') : '';
    var yearStr = (year && year !== 'N/A') ? (' ' + year) : '';
    var language = 'TAMIL';
    if (/hindi/i.test(searchString)) language = 'HINDI';
    else if (/telugu/i.test(searchString)) language = 'TELUGU';
    else if (/malayalam/i.test(searchString)) language = 'MALAYALAM';
    else if (/english|eng/i.test(searchString)) language = 'ENGLISH';
    else if (/multi/i.test(searchString)) language = 'MULTI AUDIO';
    return 'Moviesda (Instant) (' + quality + ')\n' + typeLine + '📼: ' + title + yearStr + ' ' + quality + '\n' + sizeLine + '🌐: ' + language;
}

// =================================================================================
// TMDB FUNCTIONS
// =================================================================================

function getTMDBDetails(tmdbId, mediaType) {
    var type = mediaType === 'movie' ? 'movie' : 'tv';
    var url = TMDB_BASE_URL + '/' + type + '/' + tmdbId + '?api_key=' + TMDB_API_KEY;
    return fetchWithTimeout(url, {}, 8000)
        .then(function(response) { return response.json(); })
        .then(function(data) {
            var info = {
                title: data.title || data.name,
                year: (data.release_date || data.first_air_date || '').split('-')[0]
            };
            console.log('[Moviesda] TMDB Info: "' + info.title + '" (' + (info.year || 'N/A') + ')');
            return info;
        });
}

function searchTMDBByTitle(title, mediaType) {
    var type = mediaType === 'movie' ? 'movie' : 'tv';
    var url = TMDB_BASE_URL + '/search/' + type + '?api_key=' + TMDB_API_KEY + '&query=' + encodeURIComponent(title);
    console.log('[Moviesda] Searching TMDB for: "' + title + '"');
    return fetchWithTimeout(url, {}, 8000)
        .then(function(response) { return response.json(); })
        .then(function(data) {
            if (data.results && data.results.length > 0) {
                var first = data.results[0];
                var info = {
                    title: first.title || first.name,
                    year: (first.release_date || first.first_air_date || '').split('-')[0]
                };
                console.log('[Moviesda] TMDB Result: "' + info.title + '" (' + (info.year || 'N/A') + ')');
                return info;
            }
            return null;
        })
        .catch(function(err) {
            console.error('[Moviesda] TMDB search error: ' + err.message);
            return null;
        });
}

// =================================================================================
// PAGE PARSERS
// =================================================================================

function fetchPage(url) {
    return fetchWithTimeout(url, { headers: HEADERS }, 8000)
        .then(function(response) { return response.text(); });
}

function parseMoviePage(url) {
    console.log('[Moviesda] Parsing movie page: ' + url);
    return fetchPage(url).then(function(html) {
        var $ = cheerio.load(html);
        var originalLink = $('a[href*="-original-hd"], a[href*="-original-movie"], a[href*="original"]').first();
        if (originalLink.length > 0) {
            var originalUrl = originalLink.attr('href');
            if (!originalUrl.startsWith('http')) originalUrl = MAIN_URL + originalUrl;
            console.log('[Moviesda] Found original page: ' + originalUrl);
            return parseOriginalPage(originalUrl);
        }
        var qualityLinks = [];
        $('a').each(function(i, el) {
            var href = $(el).attr('href');
            var text = $(el).text().trim();
            if (href && text.match(/\b(360p|480p|720p|1080p|4K)\b/i)) {
                var qMatch = text.match(/\b(360p|480p|720p|1080p|4K)\b/i);
                var fullUrl = href.startsWith('http') ? href : MAIN_URL + href;
                qualityLinks.push({ url: fullUrl, quality: qMatch[0], text: text });
            }
        });
        if (qualityLinks.length > 0) {
            console.log('[Moviesda] Found ' + qualityLinks.length + ' quality pages');
            return parseQualityPagesSequentially(qualityLinks, 0, []);
        }
        var streams = [];
        $('a').each(function(i, el) {
            var href = $(el).attr('href');
            var text = $(el).text().trim();
            if (href && (href.includes('/download/') || text.toLowerCase().includes('download'))) {
                var fullUrl = href.startsWith('http') ? href : MAIN_URL + href;
                streams.push({ url: fullUrl, quality: 'Unknown', type: 'download', text: text });
            }
        });
        console.log('[Moviesda] Found ' + streams.length + ' streams on page');
        return streams;
    }).catch(function(err) {
        console.error('[Moviesda] Movie page error: ' + err.message);
        return [];
    });
}

function parseOriginalPage(url) {
    console.log('[Moviesda] Parsing original page: ' + url);
    return fetchPage(url).then(function(html) {
        var $ = cheerio.load(html);
        var qualityLinks = [];
        $('a').each(function(i, el) {
            var href = $(el).attr('href');
            var text = $(el).text().trim();
            if (href && text.match(/\b(360p|480p|720p|1080p|4K)\b/i)) {
                var qMatch = text.match(/\b(360p|480p|720p|1080p|4K)\b/i);
                var fullUrl = href.startsWith('http') ? href : MAIN_URL + href;
                qualityLinks.push({ url: fullUrl, quality: qMatch[0], text: text });
            }
        });
        console.log('[Moviesda] Found ' + qualityLinks.length + ' quality pages on original page');
        return parseQualityPagesSequentially(qualityLinks, 0, []);
    }).catch(function(err) {
        console.error('[Moviesda] Original page error: ' + err.message);
        return [];
    });
}

function parseQualityPagesSequentially(qualityLinks, index, results) {
    if (index >= qualityLinks.length) return Promise.resolve(results);
    var link = qualityLinks[index];
    return parseQualityPage(link.url, link.quality)
        .then(function(streams) {
            return parseQualityPagesSequentially(qualityLinks, index + 1, results.concat(streams));
        });
}

function parseQualityPage(url, quality) {
    console.log('[Moviesda] Parsing quality page (' + quality + '): ' + url);
    return fetchPage(url).then(function(html) {
        var $ = cheerio.load(html);
        var streams = [];
        $('a').each(function(i, el) {
            var href = $(el).attr('href');
            var text = $(el).text().trim();
            if (href && (
                href.includes('/download/') ||
                href.includes('moviespage.xyz') ||
                href.includes('hubdrive') ||
                href.includes('gdrive') ||
                href.includes('pixeldrain') ||
                href.includes('hubcloud') ||
                text.toLowerCase().includes('download')
            )) {
                var fullUrl = href.startsWith('http') ? href : MAIN_URL + href;
                streams.push({ url: fullUrl, quality: quality, type: 'download', text: text });
            }
        });
        console.log('[Moviesda] Found ' + streams.length + ' download links for ' + quality);
        return streams;
    }).catch(function(err) {
        console.error('[Moviesda] Quality page error: ' + err.message);
        return [];
    });
}

function extractFinalDownloadUrl(downloadPageUrl) {
    console.log('[Moviesda] Extracting final URL from: ' + downloadPageUrl);
    return fetchPage(downloadPageUrl).then(function(html) {
        var $ = cheerio.load(html);
        var downloadLinks = [];
        $('a').each(function(i, el) {
            var href = $(el).attr('href');
            var text = $(el).text().trim().toLowerCase();
            if (href &&
                !href.includes('moviesda19.com') &&
                !href.includes('/tamil-movies/') &&
                !href.startsWith('#') &&
                (text.includes('download') || text.includes('server') || text.includes('fast') || text.includes('direct'))
            ) {
                var fullUrl = href.startsWith('http') ? href : 'https:' + href;
                downloadLinks.push(fullUrl);
            }
        });
        if (downloadLinks.length > 0) {
            var downloadUrl = downloadLinks[0];
            console.log('[Moviesda] Found download URL: ' + downloadUrl);
            if (downloadUrl.includes('download.moviespage.xyz/download/file/')) {
                var fileIdMatch = downloadUrl.match(/\/file\/(\d+)/);
                if (fileIdMatch) {
                    var streamUrl = 'https://play.onestream.today/stream/page/' + fileIdMatch[1];
                    console.log('[Moviesda] Converted to onestream URL: ' + streamUrl);
                    return { url: streamUrl, needsExtraction: true };
                }
            }
            return { url: downloadUrl, needsExtraction: false };
        }
        return null;
    }).catch(function(err) {
        console.error('[Moviesda] extractFinalDownloadUrl error: ' + err.message);
        return null;
    });
}

function extractFromOnestream(embedUrl) {
    console.log('[Moviesda] Extracting from onestream: ' + embedUrl);
    return fetchWithTimeout(embedUrl, { headers: Object.assign({}, HEADERS, { Referer: MAIN_URL }) }, 8000)
        .then(function(response) { return response.text(); })
        .then(function(html) {
            var $ = cheerio.load(html);
            var src = null;
            $('video source').each(function(i, el) {
                if (!src) src = $(el).attr('src');
            });
            if (src) {
                console.log('[Moviesda] Found direct URL from onestream: ' + src);
                return sanitizeStreamUrl(src);
            }
            var m3u8Match = html.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/i);
            if (m3u8Match) return sanitizeStreamUrl(m3u8Match[0]);
            var mp4Match = html.match(/https?:\/\/[^\s"']+\.mp4[^\s"']*/i);
            if (mp4Match) return sanitizeStreamUrl(mp4Match[0]);
            return null;
        })
        .catch(function(err) {
            console.error('[Moviesda] Onestream error: ' + err.message);
            return null;
        });
}

// =================================================================================
// STREAM PROCESSOR — sequential Promise chain
// =================================================================================

function processStreamsSequentially(streams, index, results, mediaInfo) {
    if (index >= streams.length) return Promise.resolve(results);
    var stream = streams[index];

    var urlPromise;
    if (stream.type === 'download') {
        urlPromise = extractFinalDownloadUrl(stream.url)
            .then(function(result) {
                if (!result) return null;
                if (result.needsExtraction) {
                    return extractFromOnestream(result.url);
                }
                return result.url;
            });
    } else {
        urlPromise = Promise.resolve(stream.url);
    }

    return urlPromise.then(function(finalUrl) {
        if (finalUrl) {
            results.push({
                name: 'Moviesda',
                title: formatStreamTitle(mediaInfo, stream),
                url: finalUrl,
                quality: stream.quality || 'Unknown',
                headers: {
                    'Referer': MAIN_URL,
                    'User-Agent': HEADERS['User-Agent']
                },
                provider: 'Moviesda'
            });
        }
        return processStreamsSequentially(streams, index + 1, results, mediaInfo);
    }).catch(function(err) {
        console.error('[Moviesda] Stream processing error: ' + err.message);
        return processStreamsSequentially(streams, index + 1, results, mediaInfo);
    });
}

// =================================================================================
// DIRECT URL FALLBACK — sequential Promise chain
// =================================================================================

function tryDirectUrls(urlsToTry, index, mediaInfo) {
    if (index >= urlsToTry.length) return Promise.resolve([]);
    var directUrl = urlsToTry[index];
    console.log('[Moviesda] Trying direct URL: ' + directUrl);
    return fetchWithTimeout(directUrl, { headers: HEADERS }, 5000)
        .then(function(response) {
            if (!response.ok) return tryDirectUrls(urlsToTry, index + 1, mediaInfo);
            return response.text().then(function(html) {
                if (!html.includes('entry-title') && !html.includes('movie')) {
                    return tryDirectUrls(urlsToTry, index + 1, mediaInfo);
                }
                console.log('[Moviesda] Found page at: ' + directUrl);
                return parseMoviePage(directUrl).then(function(rawStreams) {
                    if (rawStreams.length === 0) return tryDirectUrls(urlsToTry, index + 1, mediaInfo);
                    var limited = rawStreams.slice(0, 5);
                    return processStreamsSequentially(limited, 0, [], mediaInfo)
                        .then(function(finalStreams) {
                            if (finalStreams.length === 0) return tryDirectUrls(urlsToTry, index + 1, mediaInfo);
                            return finalStreams;
                        });
                });
            });
        })
        .catch(function(err) {
            console.log('[Moviesda] Direct URL failed: ' + err.message);
            return tryDirectUrls(urlsToTry, index + 1, mediaInfo);
        });
}

// =================================================================================
// MAIN FUNCTION
// =================================================================================

function getStreams(tmdbId, mediaType, season, episode) {
    mediaType = mediaType || 'movie';
    console.log('[Moviesda] Processing ' + mediaType + ' ' + tmdbId);

    var isNumericId = /^\d+$/.test(String(tmdbId));
    var mediaInfoPromise;

    if (isNumericId) {
        mediaInfoPromise = getTMDBDetails(tmdbId, mediaType)
            .catch(function() {
                return { title: String(tmdbId), year: null };
            });
    } else {
        mediaInfoPromise = searchTMDBByTitle(String(tmdbId), mediaType)
            .then(function(result) {
                return (result && result.year) ? result : { title: String(tmdbId), year: null };
            })
            .catch(function() {
                return { title: String(tmdbId), year: null };
            });
    }

    return mediaInfoPromise.then(function(mediaInfo) {
        console.log('[Moviesda] Looking for: "' + mediaInfo.title + '" (' + (mediaInfo.year || 'N/A') + ')');

        var currentYear = new Date().getFullYear();
        var yearsToTry = mediaInfo.year
            ? [mediaInfo.year, String(currentYear), String(currentYear - 1)]
            : [String(currentYear), String(currentYear - 1), String(currentYear - 2), String(currentYear - 3)];

        var slug = mediaInfo.title.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, '-');

        var urlsToTry = [];
        yearsToTry.forEach(function(year) {
            urlsToTry.push(MAIN_URL + '/' + slug + '-' + year + '-tamil-movie/');
            urlsToTry.push(MAIN_URL + '/' + slug + '-' + year + '-hindi-movie/');
            urlsToTry.push(MAIN_URL + '/' + slug + '-' + year + '-telugu-movie/');
        });
        urlsToTry.push(MAIN_URL + '/' + slug + '-tamil-movie/');

        return tryDirectUrls(urlsToTry, 0, mediaInfo);
    }).catch(function(err) {
        console.error('[Moviesda] getStreams failed: ' + err.message);
        return [];
    });
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams: getStreams };
} else {
    global.getStreams = getStreams;
}
