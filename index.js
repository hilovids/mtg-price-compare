const fs = require('fs');
const csv = require('csv-parser');
const { error } = require('console');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const markup = 1.2; // 20% markup for checking if a card is above market
const fileName = "cards.csv";

async function parseCSV(filePath) {
    const result = [];
    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .on('error', error => {
                reject(error);
            })
            .pipe(csv())
            .on('data', (item) => {
                result.push(item);
            })
            .on('end', () => {
                resolve(result);
            });
    });
}

async function searchCardByName(name) {
    const response = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`);
    const data = await response.json();
    return data;
}

async function fetchPrints(printsUrl) {
    const response = await fetch(printsUrl);
    const data = await response.json();
    return data.data;
}

function getPrices(print) {
    const prices = Object.keys(print.prices)
        .filter(key => key.includes('usd'))
        .reduce((acc, key) => {
            acc[key] = print.prices[key];
            return acc;
        }, {});
    return { id: print.id, name: print.name, prices };
}

async function main() {
    const cards = await parseCSV(fileName);
    const results = { aboveMarket: [], belowMarket: [], errors: [] };
    for (const card of cards) {
        try {
            const cardData = await searchCardByName(card.Name);
            if (cardData.error) {
                console.error(`Card not found: ${card.Name}`);
                continue;
            }

            console.log(`Card: ${card.Name}, Scryfall ID: ${cardData.id}`);
            const printsUrl = cardData.prints_search_uri;
            const prints = await fetchPrints(printsUrl);
            // console.log(`Prints for ${card.Name}:`);
            const printPrices = prints.map(p => getPrices(p));
            // console.log(printPrices);
            let lowestPrice = 0;
            printPrices.forEach(p => {
                const usdPrice = parseFloat(p.prices.usd ?? '10000000');
                const usdFoilPrice = parseFloat(p.prices.usd_foil ?? '10000000');
                const usdEtchedPrice = parseFloat(p.prices.usd_etched ?? '10000000');
                const minPrice = Math.min(usdPrice, usdFoilPrice, usdEtchedPrice);
                if (minPrice < lowestPrice || lowestPrice === 0) {
                    lowestPrice = minPrice;
                }
            });
            const printingOwned = printPrices.find(p => p.id === cardData.id);
            let ownedPrice = 0;
            switch(card["Foil"]) {
                case "normal":
                ownedPrice = parseFloat(printingOwned.prices.usd ?? '0');
                break;
                case "foil":
                ownedPrice = parseFloat(printingOwned.prices.usd_foil ?? printingOwned.prices.usd ?? '0');
                break;
                case "etched":
                ownedPrice = parseFloat(printingOwned.prices.usd_etched ?? printingOwned.prices.usd_foil ?? printingOwned.prices.usd ?? '0');
                break;
            }
            console.log(`Lowest Price: $${lowestPrice}, Owned Price: $${ownedPrice}`);
            if(ownedPrice === 0) {
                console.log(`No owned price for ${card.Name}, skipping...`);
                results.errors.push({ name: card.Name, message: "Owned Price not found" });
                continue;
            }
            if (ownedPrice > lowestPrice * markup) {
                results.aboveMarket.push({ name: card.Name, ownedPrice, lowestPrice, difference: (ownedPrice - lowestPrice).toFixed(2), percentage: ((ownedPrice - lowestPrice) / lowestPrice * 100).toFixed(2) + "%" });
            } else {
                results.belowMarket.push({ name: card.Name, ownedPrice, lowestPrice, difference: (ownedPrice - lowestPrice).toFixed(2), percentage: ((ownedPrice - lowestPrice) / lowestPrice * 100).toFixed(2) + "%" });
            }

        } catch (error) {
            console.error(`Error fetching data for card: ${card.Name}`, error);
        }
        await delay(75);
    }
    fs.writeFile(`./prices_output/card_prices_${Date.now()}.json`, JSON.stringify(results, null, 2), err => {
        if (err) {
            console.error(err);
        }
    });
}

main();