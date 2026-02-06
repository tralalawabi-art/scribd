const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper Function: Scraper Logic
async function getScribdDownload(scribdUrl) {
    let browser = null;
    try {
        browser = await puppeteer.launch({
            args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });

        const page = await browser.newPage();
        let capturedMeta = null;

        // Intercept Response untuk mendapatkan Meta Data (JSON)
        await page.setRequestInterception(true);
        page.on('request', (req) => req.continue());

        page.on('response', async (res) => {
            const url = res.url();
            // Cek endpoint internal scribd-downloader.co yang berisi info PDF
            if (url.includes('/document/') && res.request().method() === 'GET') {
                try {
                    const json = await res.json();
                    if (json.id) {
                        capturedMeta = json;
                    }
                } catch (e) {
                    // Ignore parsing errors
                }
            }
        });

        await page.goto('https://scribd-downloader.co/', { 
            waitUntil: 'networkidle2', 
            timeout: 30000 
        });

        const inputSelector = 'input[type="text"], input[type="url"], input.form-control';
        await page.waitForSelector(inputSelector, { visible: true });

        // Input URL ke website
        await page.type(inputSelector, scribdUrl);
        await delay(500);
        await page.keyboard.press('Enter');

        // Tunggu sampai meta tertangkap (max 15 detik)
        for (let i = 0; i < 30; i++) {
            if (capturedMeta) break;
            await delay(500);
        }

        if (!capturedMeta || !capturedMeta.pdfUrl) {
            throw new Error("Gagal mendapatkan metadata dokumen.");
        }

        await browser.close();

        // Polling ke API downloader sampai file ready (Status 'done')
        let finalUrl = null;
        let attempts = 0;
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
            'Referer': 'https://scribd-downloader.co/',
        };

        while (!finalUrl && attempts < 20) {
            try {
                const { data } = await axios.get(capturedMeta.pdfUrl, { headers });
                if (data.status === 'done' && data.url) {
                    finalUrl = data.url;
                } else {
                    await delay(3000); // Tunggu 3 detik sebelum cek lagi
                    attempts++;
                }
            } catch (e) {
                attempts++;
                await delay(2000);
            }
        }

        return {
            status: true,
            title: capturedMeta.title?.trim() || "No Title",
            author: capturedMeta.author,
            desc: capturedMeta.desc,
            pageCount: capturedMeta.pageCount,
            views: capturedMeta.views,
            imageUrl: capturedMeta.imageUrl,
            download_url: finalUrl || "Process timeout"
        };

    } catch (err) {
        if (browser) await browser.close();
        throw err;
    }
}

// Endpoint API
app.get('/api/tools/scribd', async (req, res) => {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({
            status: false,
            message: "Parameter 'url' wajib diisi!"
        });
    }

    if (!url.includes('scribd.com/document/')) {
        return res.status(400).json({
            status: false,
            message: "URL tidak valid. Masukkan URL dokumen Scribd yang benar."
        });
    }

    try {
        const result = await getScribdDownload(url);
        res.json({
            creator: "ScraperAPI",
            result
        });
    } catch (error) {
        res.status(500).json({
            status: false,
            message: error.message
        });
    }
});

// Root route
app.get('/', (req, res) => {
    res.json({
        message: "Scribd Downloader API is Running",
        usage: "/api/tools/scribd?url=HTTPS_SCRIBD_URL"
    });
});

module.exports = app;
