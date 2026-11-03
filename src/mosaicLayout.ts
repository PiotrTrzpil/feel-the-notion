/**
 * Justified mosaic rows, the same packing photo-mosaic uses.
 *
 * Every full row spans the width and keeps each image's aspect ratio, so row
 * heights sit near the target. The last row takes the full rows' average
 * height and is not stretched past it. Extreme panoramas and slivers are
 * clamped, then cropped by the tile. Pure. See test/mosaicLayout.test.mjs.
 */

export interface TileFrame {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface MosaicRow {
	/** Items of this row, as a half-open range into the input. */
	start: number;
	end: number;
	y: number;
	height: number;
	frames: TileFrame[];
}

export interface MosaicLayout {
	rows: MosaicRow[];
	totalHeight: number;
}

/** A note column is narrower than a photo window, so rows sit under photo-mosaic's 240. */
export const MOSAIC_TARGET_HEIGHT = 180;
export const MOSAIC_SPACING = 4;

const ASPECT_MIN = 0.25;
const ASPECT_MAX = 5;

/** Non-positive or non-finite aspects become square. Others clamp into range. */
export function displayAspect(aspect: number): number {
	if (!Number.isFinite(aspect) || aspect <= 0) return 1;
	return Math.min(Math.max(aspect, ASPECT_MIN), ASPECT_MAX);
}

/**
 * True when every entry is an image attachment. A page, a folder, or any
 * other file means the folder is not an image folder.
 */
export function folderIsImages(
	entries: readonly { kind: string; extension: string }[],
	images: ReadonlySet<string>,
): boolean {
	return entries.length > 0 && entries.every(
		(entry) => entry.kind === "attachment" && images.has(entry.extension.toLowerCase()),
	);
}

/**
 * `captionHeight` is room under every row. Tile frames cover only the images.
 * An empty list, or a non-positive width or target, lays out nothing.
 */
export function justifiedLayout(
	aspects: readonly number[],
	width: number,
	targetHeight: number,
	spacing: number,
	captionHeight = 0,
): MosaicLayout {
	const clamped = aspects.map(displayAspect);
	if (clamped.length === 0 || width <= 0 || targetHeight <= 0) {
		return { rows: [], totalHeight: 0 };
	}

	const rows: MosaicRow[] = [];
	let y = 0;
	let start = 0;

	// Height at which items start..<end exactly fill the width.
	const fillHeight = (end: number, aspectSum: number): number =>
		(width - spacing * (end - start - 1)) / aspectSum;

	const closeRow = (end: number, height: number, fill: boolean): void => {
		const frames: TileFrame[] = [];
		let x = 0;
		for (let index = start; index < end; index++) {
			const isLast = index === end - 1;
			// The last tile of a full row takes the rounding remainder.
			const tileWidth = isLast && fill ? width - x : clamped[index] * height;
			frames.push({ x, y, width: tileWidth, height });
			x += tileWidth + spacing;
		}
		rows.push({ start, end, y, height, frames });
		y += height + captionHeight + spacing;
		start = end;
	};

	let aspectSum = 0;
	let index = 0;
	while (index < clamped.length) {
		aspectSum += clamped[index];
		const end = index + 1;
		const height = fillHeight(end, aspectSum);
		if (height <= targetHeight) {
			// Adding this item shrank the row to the target or below: keep it,
			// or drop it to the next row if the row without it lands closer
			// to the target (compared as ratios).
			const without = end - start > 1
				? fillHeight(end - 1, aspectSum - clamped[index])
				: Number.POSITIVE_INFINITY;
			if (Number.isFinite(without) && without / targetHeight < targetHeight / height) {
				closeRow(end - 1, without, true);
				aspectSum = 0;
				continue;
			}
			closeRow(end, height, true);
			aspectSum = 0;
		}
		index += 1;
	}
	if (start < clamped.length) {
		// Matches the full rows (not the target, which they can overshoot),
		// so a last row with enough items to fill the width looks like the
		// rest; one with fewer is never stretched past that height.
		const typical = rows.length === 0
			? targetHeight
			: rows.reduce((sum, row) => sum + row.height, 0) / rows.length;
		const fill = fillHeight(clamped.length, aspectSum);
		closeRow(clamped.length, Math.min(typical, fill), fill <= typical);
	}

	return { rows, totalHeight: Math.max(0, y - spacing) };
}
