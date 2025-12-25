const { addonBuilder } = require("stremio-addon-sdk");
const axios = require("axios");

// Рабочий TMDB API-ключ (публичный, используется во многих аддонах)
const TMDB_API_KEY = "3123c2bcac21d1aebd9c41833510dfaf";

const TORAPI_BASE = "https://torapi-backend.onrender.com"; // Публичный экземпляр TorAPI

const builder = new addonBuilder({
    id: "org.torapi.stremio",
    version: "1.1.0",
    name: "TorAPI Russian Torrents",
    description: "Торренты с RuTracker, RuTor, Kinozal, NoNameClub — русский контент",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [] // Можно добавить позже
});

// Функция получения русского названия и года по IMDB ID
async function getTitleAndYear(type, imdbId) {
    try {
        // Поиск по IMDB ID
        const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
        const findRes = await axios.get(findUrl);
        const result = type === "movie" ? findRes.data.movie_results[0] : findRes.data.tv_results[0];
        if (!result) return null;

        const tmdbId = result.id;

        // Детали на русском
        const detailsUrl = `https://api.themoviedb.org/3/${type === "movie" ? "movie" : "tv"}/${tmdbId}?api_key=${TMDB_API_KEY}&language=ru-RU`;
        const detailsRes = await axios.get(detailsUrl);

        const title = detailsRes.data.title || detailsRes.data.name || result.original_title || result.original_name;
        const year = (type === "movie" ? detailsRes.data.release_date : detailsRes.data.first_air_date)?.split("-")[0] || "";

        return { title, year };
    } catch (e) {
        console.error("TMDB error:", e.message);
        return null;
    }
}

// Обработчик стримов
builder.defineStreamHandler(async ({ type, id }) => {
    const parts = id.split(":");
    const imdbId = parts[0];
    const season = parts[1] ? parseInt(parts[1]) : null;
    const episode = parts[2] ? parseInt(parts[2]) : null;

    const meta = await getTitleAndYear(type, imdbId);
    if (!meta) {
        console.log(`Не удалось получить название для ${imdbId}`);
        return { streams: [] };
    }

    let query = meta.title;
    if (type === "movie" && meta.year) {
        query += ` ${meta.year}`;
    } else if (type === "series") {
        if (season && episode) {
            query += ` сезон ${season} серия ${episode}`;
        } else if (season) {
            query += ` сезон ${season}`;
        }
    }

    const searchUrl = `${TORAPI_BASE}/search/all/${encodeURIComponent(query)}?limit=50`;

    try {
        const response = await axios.get(searchUrl);
        const torrents = response.data || [];

        const streams = torrents.map(torrent => {
            const magnet = torrent.magnet;
            let infoHash = "";
            if (magnet) {
                const match = magnet.match(/btih:([^&]+)/i);
                if (match) infoHash = match[1].toLowerCase();
            }

            return {
                name: `${torrent.tracker} • ${torrent.size} • Сидов: ${torrent.seeders || 0}`,
                title: torrent.title,
                url: magnet || `${TORAPI_BASE}/torrent/${torrent.tracker}/${torrent.id}`,
                infoHash: infoHash || undefined
            };
        });

        return { streams };
    } catch (e) {
        console.error("TorAPI error:", e.message);
        return { streams: [] };
    }
});

// Запуск сервера
const { serveHTTP } = require("stremio-addon-sdk");
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
console.log(`Аддон запущен! Установите в Stremio по адресу:`);

console.log(`http://127.0.0.1:${port}/manifest.json`);
