import test from "node:test";
import assert from "node:assert/strict";
import { formatInvestmentPrice, formatQuantity } from "../src/lib/investments/display.ts";

test("localized investment display preserves exact source decimals", () => {
  const repeating = "101866.666666666666666667";
  assert.equal(formatInvestmentPrice(repeating, "IDR", 0), "Rp101.866,67");
  assert.equal(repeating, "101866.666666666666666667");
  assert.equal(formatInvestmentPrice("0.00000001", "IDR", 0), "Rp0,00000001");
  assert.equal(formatInvestmentPrice("1234.56789", "USD", 2), "USD 1.234,5679");
  assert.equal(formatQuantity("1.527310000000000000"), "1,52731");
  assert.equal(formatQuantity("1234567.000000000000000001"), "1.234.567,000000000000000001");
});
