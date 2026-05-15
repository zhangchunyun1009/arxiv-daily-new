import { readFile } from "node:fs/promises";

const dataUrl = new URL("../public/data/latest.json", import.meta.url);
const payload = JSON.parse(await readFile(dataUrl, "utf8"));

if (payload.schemaVersion !== 1) throw new Error("Unexpected schemaVersion");
if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) throw new Error("Invalid date");
if (!Array.isArray(payload.topics) || payload.topics.length === 0) throw new Error("Missing topics");

for (const topic of payload.topics) {
  if (!topic.id || !topic.name) throw new Error("Topic is missing id/name");
  if (!Array.isArray(topic.papers)) throw new Error(`${topic.name} papers is not an array`);
  for (const paper of topic.papers) {
    if (!paper.id || !paper.title || !paper.published) {
      throw new Error(`${topic.name} has an invalid paper record`);
    }
  }
}

console.log(`Validated ${payload.topics.length} topics for ${payload.date}`);
