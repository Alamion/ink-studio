import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, LABEL_LENGTH_RANGE, sanitizeSettings } from "../src/settings";

describe("sanitizeSettings", () => {
	it("falls back to defaults for missing or non-object data", () => {
		expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
		expect(sanitizeSettings("nonsense")).toEqual(DEFAULT_SETTINGS);
		expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
	});

	it("keeps valid values", () => {
		const custom = { newKnotTarget: "ask", labelMaxLength: 50, labelMaxLines: 5, sidePanel: "closed", confirmDeletes: "always" } as const;
		expect(sanitizeSettings(custom)).toEqual(custom);
	});

	it("rejects unknown choices and clamps numbers into their range", () => {
		const result = sanitizeSettings({ newKnotTarget: "somewhere", sidePanel: 3, confirmDeletes: null, labelMaxLength: 9999, labelMaxLines: -4 });
		expect(result.newKnotTarget).toBe(DEFAULT_SETTINGS.newKnotTarget);
		expect(result.sidePanel).toBe(DEFAULT_SETTINGS.sidePanel);
		expect(result.confirmDeletes).toBe(DEFAULT_SETTINGS.confirmDeletes);
		expect(result.labelMaxLength).toBe(LABEL_LENGTH_RANGE.max);
		expect(result.labelMaxLines).toBe(1);
	});

	it("ignores non-finite numbers and rounds fractions", () => {
		expect(sanitizeSettings({ labelMaxLength: Number.NaN }).labelMaxLength).toBe(DEFAULT_SETTINGS.labelMaxLength);
		expect(sanitizeSettings({ labelMaxLength: "40" }).labelMaxLength).toBe(DEFAULT_SETTINGS.labelMaxLength);
		expect(sanitizeSettings({ labelMaxLines: 2.6 }).labelMaxLines).toBe(3);
	});
});
