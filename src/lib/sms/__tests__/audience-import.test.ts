import { describe, expect, it } from "vitest";
import { parseAudienceCsv } from "../audience-import";

describe("parseAudienceCsv", () => {
  it("accepts a header row and normalises mobiles", () => {
    const result = parseAudienceCsv("first_name,last_name,phone\nAlex,Mitchell,0412345678");
    expect(result.rejects).toEqual([]);
    expect(result.rows).toEqual([
      {
        first_name: "Alex",
        last_name: "Mitchell",
        phone: "0412345678",
        phone_e164: "+61412345678",
        line: 2,
      },
    ]);
  });

  it("rejects a bare number and an invalid mobile with reasons", () => {
    const result = parseAudienceCsv(
      "first_name,last_name,phone\n,,0412345678\nAlex,Mitchell,not-a-phone",
    );
    expect(result.rows).toHaveLength(0);
    expect(result.rejects.map((row) => row.reason)).toEqual([
      "First and last name are both required",
      "Not a valid Australian mobile",
    ]);
  });

  it("splits a single name column", () => {
    const result = parseAudienceCsv('name,mobile\n"Sam Taylor",0411111111');
    expect(result.rows[0]?.first_name).toBe("Sam");
    expect(result.rows[0]?.last_name).toBe("Taylor");
  });
});
