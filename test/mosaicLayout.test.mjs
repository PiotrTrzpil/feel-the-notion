/**
 * Justified mosaic packing, ported from photo-mosaic's layout checks.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { displayAspect, folderIsImages, justifiedLayout } from "./.build/mosaicLayout.js";

const near = (actual, expected) => {
	assert.ok(Math.abs(actual - expected) < 0.001, `${actual} ~= ${expected}`);
};

const images = new Set(["jpg", "png", "gif", "webp"]);

test("an empty folder is not an image folder", () => {
	assert.equal(folderIsImages([], images), false);
});

test("a folder of only images is an image folder", () => {
	assert.equal(folderIsImages([
		{ kind: "attachment", extension: "JPG" },
		{ kind: "attachment", extension: "png" },
	], images), true);
});

test("a page, a folder, or another file keeps the list", () => {
	assert.equal(folderIsImages([
		{ kind: "attachment", extension: "jpg" },
		{ kind: "page", extension: "md" },
	], images), false);
	assert.equal(folderIsImages([
		{ kind: "attachment", extension: "jpg" },
		{ kind: "folder", extension: "" },
	], images), false);
	assert.equal(folderIsImages([
		{ kind: "attachment", extension: "jpg" },
		{ kind: "attachment", extension: "pdf" },
	], images), false);
});

test("empty input has no rows", () => {
	const layout = justifiedLayout([], 1000, 200, 4);
	assert.deepEqual(layout.rows, []);
	assert.equal(layout.totalHeight, 0);
});

test("full rows span the width and keep aspect ratios", () => {
	const aspects = [1.5, 0.75, 1.0, 1.5, 1.33, 0.66, 1.5, 1.5, 2.0, 1.0, 0.8, 1.5];
	const layout = justifiedLayout(aspects, 1000, 200, 4);
	for (const row of layout.rows.slice(0, -1)) {
		const last = row.frames[row.frames.length - 1];
		near(last.x + last.width, 1000);
		for (let offset = 0; offset < row.frames.length - 1; offset++) {
			const frame = row.frames[offset];
			near(frame.width / frame.height, aspects[row.start + offset]);
		}
	}
});

test("row heights stay near the target", () => {
	const aspects = Array.from({ length: 25 }, () => [1.5, 0.67, 1.0, 1.78]).flat();
	const layout = justifiedLayout(aspects, 1200, 240, 4);
	for (const row of layout.rows.slice(0, -1)) {
		assert.ok(row.height > 240 * 0.7 && row.height < 240 * 1.4);
	}
});

test("the last row is not stretched", () => {
	const layout = justifiedLayout([1, 1], 1000, 200, 4);
	assert.equal(layout.rows.length, 1);
	assert.equal(layout.rows[0].height, 200);
	assert.equal(layout.rows[0].frames[1].x, 204);
});

test("a full last row matches the other rows", () => {
	const layout = justifiedLayout(Array(20).fill(4 / 3), 1432, 240, 4);
	assert.deepEqual(layout.rows.map((row) => row.end - row.start), [4, 4, 4, 4, 4]);
	const heights = layout.rows.map((row) => row.height);
	for (const height of heights) near(height, heights[0]);
	const last = layout.rows[layout.rows.length - 1].frames.at(-1);
	near(last.x + last.width, 1432);
});

test("a short last row uses the full rows' height", () => {
	const layout = justifiedLayout(Array(9).fill(4 / 3), 1432, 240, 4);
	assert.deepEqual(layout.rows.map((row) => row.end - row.start), [4, 4, 1]);
	near(layout.rows[2].height, layout.rows[0].height);
	assert.ok(layout.rows[2].frames[0].width < 1432 / 2);
});

test("every item is placed once in order", () => {
	const aspects = Array.from({ length: 57 }, (_, index) => ((index % 5) + 1) / 3);
	const layout = justifiedLayout(aspects, 900, 180, 2);
	const placed = layout.rows.flatMap((row) =>
		Array.from({ length: row.end - row.start }, (_, offset) => row.start + offset));
	assert.deepEqual(placed, Array.from({ length: 57 }, (_, index) => index));
	for (const row of layout.rows) assert.equal(row.frames.length, row.end - row.start);
});

test("rows stack with spacing", () => {
	const layout = justifiedLayout(Array(20).fill(1.5), 1000, 200, 4);
	for (let index = 1; index < layout.rows.length; index++) {
		const previous = layout.rows[index - 1];
		near(layout.rows[index].y, previous.y + previous.height + 4);
	}
	const last = layout.rows[layout.rows.length - 1];
	near(layout.totalHeight, last.y + last.height);
});

test("a panorama wider than the row gets its own row", () => {
	const layout = justifiedLayout([5, 1, 1], 800, 200, 4);
	assert.equal(layout.rows[0].start, 0);
	assert.equal(layout.rows[0].end, 1);
	assert.equal(layout.rows[0].frames[0].width, 800);
	assert.equal(layout.rows[0].height, 160);
});

test("extreme aspects are clamped", () => {
	assert.equal(displayAspect(20), 5);
	assert.equal(displayAspect(0.01), 0.25);
	assert.equal(displayAspect(0), 1);
	assert.equal(displayAspect(Number.NaN), 1);
});

test("degenerate sizes have no rows", () => {
	assert.deepEqual(justifiedLayout([1], 0, 200, 4).rows, []);
	assert.deepEqual(justifiedLayout([1], 100, 0, 4).rows, []);
});

test("captions add room under each row", () => {
	const layout = justifiedLayout(Array(20).fill(1.5), 1000, 200, 4, 18);
	for (let index = 1; index < layout.rows.length; index++) {
		const previous = layout.rows[index - 1];
		near(layout.rows[index].y, previous.y + previous.height + 18 + 4);
	}
	const last = layout.rows[layout.rows.length - 1];
	near(layout.totalHeight, last.y + last.height + 18);
});
