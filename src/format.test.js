import { describe, it, expect, beforeEach } from "vitest";
import { init, t } from "./i18n.js";
import { fmtNum, fmtTokens } from "./format.js";

describe("fmtTokens", () => {
  beforeEach(() => init("en"));
  it("короткие числа без суффиксов", () => {
    expect(fmtTokens(950)).toBe("950");
    expect(fmtTokens(1500)).toBe("2K");
  });
  it("миллионы/миллиарды", () => {
    expect(fmtTokens(2_500_000)).toBe("2.5M");
    expect(fmtTokens(3_000_000_000)).toBe("3B"); // целые — без дробной части
  });
  it("null -> пусто", () => {
    expect(fmtTokens(null)).toBe("");
  });
  it("zh: 亿/миллионы как M", () => {
    init("zh");
    expect(fmtTokens(250_000_000)).toBe("2.5亿");
    expect(fmtTokens(15_000_000)).toBe("15M"); // fmtTokens в zh: 万 только >=1e6→M
    init("en");
  });
});

describe("fmtNum", () => {
  beforeEach(() => init("en"));
  it("неизвестное значение -> локализованное 'неизвестно'", () => {
    expect(fmtNum(null)).toBe(t("q.unknown"));
    expect(fmtNum("abc")).toBe(t("q.unknown"));
  });
  it("миллионы в en", () => {
    expect(fmtNum(2_500_000)).toBe("2.50M");
  });
});
