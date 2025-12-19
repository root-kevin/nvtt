// Run with: node scripts/validate-fog.js

import fs from "fs";
import path from "path";

const root = "./src";

console.log("Checking for forbidden fogPng references...\n");

let found = false;

function scan(dir) {
    for (const file of fs.readdirSync(dir)) {
        const full = path.join(dir, file);
        const stat = fs.statSync(full);

        if (stat.isDirectory()) {
            scan(full);
        } else {
            const contents = fs.readFileSync(full, "utf8");
            if (contents.includes("fogPng")) {
                found = true;
                console.log(`❌ fogPng Found in: ${full}`);
            }
        }
    }
}

scan(root);

if (!found) {
    console.log("✅ No fogPng references found. Safe for file-based fog.");
} else {
    console.log("\n❌ REMOVE ALL fogPng REFERENCES BEFORE RUNNING.");
}
