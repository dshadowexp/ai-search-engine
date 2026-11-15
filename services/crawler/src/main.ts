import { LogStream } from "@search/infra";
import { createCrawler } from "./setup.ts";

async function startCrawler() {
    LogStream.getInstance().addStream(process.stdout);

    const { crawler } = createCrawler(
        { userAgent: "CruwlBot/1.0 (+https://example.com/bot)" }, 
    );
    LogStream.getInstance().log(await crawler.seed([
        // "https://wagslane.dev", 
        // "https://toscrape.com",
        "https://readykare.com"
    ]));
    crawler.start();

    const inter = setInterval(async () => {
        LogStream.getInstance().log(await crawler.getStats());
    }, 5000);

    setTimeout(async () => {
        await crawler.stop();
        clearInterval(inter);
        process.exit(0)
    }, 20000)
}

startCrawler();