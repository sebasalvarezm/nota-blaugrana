import type { Role } from "@/lib/types";

export const ratingTemplates: Record<Role, Array<[string, string]>> = {
  GK: [
    ["distribution", "Distribution"],
    ["handling", "Handling & security"],
    ["interventions", "Interventions"],
    ["decisions", "Decisions & sweeping"],
  ],
  CB: [
    ["positioning", "Positioning"],
    ["duels", "Duels & defending"],
    ["buildUp", "Build-up passing"],
    ["cover", "Cover & recovery"],
  ],
  FB: [
    ["defending", "1v1 defending"],
    ["positioning", "Positioning"],
    ["progression", "Ball progression"],
    ["delivery", "Width & final ball"],
  ],
  PIVOT: [
    ["resistance", "Press resistance"],
    ["distribution", "Distribution"],
    ["positioning", "Defensive positioning"],
    ["recovery", "Ball recovery"],
  ],
  MID: [
    ["resistance", "Press resistance"],
    ["progression", "Passing & progression"],
    ["creativity", "Creativity"],
    ["tempo", "Tempo & work rate"],
  ],
  WING: [
    ["oneVOne", "1v1 ability"],
    ["progression", "Ball progression"],
    ["finalBall", "Creativity & final ball"],
    ["endProduct", "End product"],
  ],
  ST: [
    ["movement", "Movement"],
    ["linkUp", "Link-up play"],
    ["finishing", "Finishing"],
    ["pressing", "Pressing & box presence"],
  ],
};

export const scoreDescriptions = ["", "Rough", "Below par", "Solid", "Strong", "Elite"];
