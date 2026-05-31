import { describe, it, expect } from "vitest";
import {
  parseStations,
  parseLatestValue,
} from "../../src/api/spring/services/chmu-client";

const meta1 = {
  data: {
    type: "DataCollection",
    data: {
      header: "objID,DBC,OBJECT_NAME,OBJECT_TYPE,GEOGR1,GEOGR2,ALTITUDE",
      values: [
        ["0-203-1-PB0013", "PB0013", "Ostružná", "spring", 50.1798186, 17.0549236, 697],
        ["0-999-9-RIVER1", "RV1", "Vltava", "watercourse", 50.0, 14.0, 200],
        ["0-203-1-BAD", "BAD", "No coords", "spring", "x", "y", 100],
      ],
    },
  },
};

describe("parseStations", () => {
  it("returns only OBJECT_TYPE === 'spring' rows, mapped positionally", () => {
    const stations = parseStations(meta1);
    expect(stations).toHaveLength(1);
    expect(stations[0]).toEqual({
      externalId: "0-203-1-PB0013",
      name: "Ostružná",
      lat: 50.1798186,
      lng: 17.0549236,
      altitude: 697,
    });
  });

  it("skips springs with invalid coordinates", () => {
    // the third row is a spring but has non-numeric GEOGR → skipped
    expect(parseStations(meta1).map((s) => s.externalId)).not.toContain(
      "0-203-1-BAD"
    );
  });

  it("returns [] for empty/garbage input", () => {
    expect(parseStations(null)).toEqual([]);
    expect(parseStations({})).toEqual([]);
  });
});

describe("parseLatestValue", () => {
  const dataJson = {
    objList: [
      {
        objID: "0-203-1-PB0013",
        tsList: [
          { tsConID: "HD", unit: "MNM", tsData: [{ dt: "2026-05-30T05:00:00Z", value: 300 }] },
          {
            tsConID: "YD",
            unit: "L_S",
            tsData: [
              { dt: "2026-05-01T05:00:00Z", value: 1.14733 },
              { dt: "2026-05-30T05:00:00Z", value: 1.06418 },
            ],
          },
        ],
      },
    ],
  };

  it("selects the YD/L_S series and the newest point by dt", () => {
    expect(parseLatestValue(dataJson)).toEqual({
      dt: "2026-05-30T05:00:00Z",
      valueLps: 1.06418,
    });
  });

  it("ignores series order (picks by tsConID+unit, not index)", () => {
    const reordered = {
      objList: [
        {
          tsList: [
            { tsConID: "YD", unit: "L_S", tsData: [{ dt: "2026-05-30T05:00:00Z", value: 2 }] },
            { tsConID: "HD", unit: "MNM", tsData: [{ dt: "2026-05-30T05:00:00Z", value: 9 }] },
          ],
        },
      ],
    };
    expect(parseLatestValue(reordered)?.valueLps).toBe(2);
  });

  it("returns null on empty tsData, missing series, or null input", () => {
    expect(parseLatestValue({ objList: [{ tsList: [{ tsConID: "YD", unit: "L_S", tsData: [] }] }] })).toBeNull();
    expect(parseLatestValue({ objList: [{ tsList: [{ tsConID: "HD", unit: "MNM", tsData: [{ dt: "x", value: 1 }] }] }] })).toBeNull();
    expect(parseLatestValue(null)).toBeNull();
  });
});
