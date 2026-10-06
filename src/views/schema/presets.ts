// Starter schemas for the Schema Builder.
// Placeholder data only (no real people).

import { newId } from "../../lib/api";
import type { SchemaDefinition, SchemaProperty, SchemaPropertyType } from "../../lib/fmArgs";

export interface SchemaPreset {
  id: string;
  label: string;
  /** A prompt for the "Try it" box that fits this schema. */
  samplePrompt: string;
  build: () => SchemaDefinition;
}

export function newProperty(partial: Partial<SchemaProperty> = {}): SchemaProperty {
  return {
    id: newId(),
    name: "",
    type: "string",
    isArray: false,
    isOptional: false,
    description: "",
    ...partial,
  };
}

const p = (name: string, type: SchemaPropertyType, description = "", extra: Partial<SchemaProperty> = {}) =>
  newProperty({ name, type, description, ...extra });

export const PRESETS: SchemaPreset[] = [
  {
    id: "person",
    label: "Person",
    samplePrompt:
      "Ada Lovelace is a 36 year old mathematician from London. She enjoys poetry, music and riding horses.",
    build: () => ({
      rootName: "Person",
      properties: [
        p("name", "string", "Full name"),
        p("age", "integer", "Age in years"),
        p("occupation", "string", "Job or main activity", { isOptional: true }),
        p("hobbies", "string", "Things the person enjoys", { isArray: true }),
        p("address.city", "string", "City where the person lives"),
      ],
    }),
  },
  {
    id: "recipe",
    label: "Recipe",
    samplePrompt:
      "Pancakes for 4 people: mix 2 cups of flour, 2 eggs, 1.5 cups of milk and a pinch of salt. Rest the batter for 5 minutes, then cook each pancake for 2 minutes per side. About 25 minutes in total.",
    build: () => ({
      rootName: "Recipe",
      properties: [
        p("title", "string", "Name of the dish"),
        p("servings", "integer", "Number of people it serves"),
        p("totalMinutes", "integer", "Total time in minutes"),
        p("ingredients", "string", "One ingredient with its amount per item", { isArray: true }),
        p("steps", "string", "One short step per item, in order", { isArray: true }),
        p("vegetarian", "boolean", "True when the dish has no meat or fish"),
      ],
    }),
  },
  {
    id: "event",
    label: "Event",
    samplePrompt:
      "Team offsite on March 3, 2027 at the Example Conference Center in Lisbon, from 9 am to 5 pm. Bring a laptop and a charger.",
    build: () => ({
      rootName: "Event",
      properties: [
        p("title", "string", "Short name of the event"),
        p("date", "string", "Date in ISO 8601 format, like 2027-03-03"),
        p("startTime", "string", "24 hour time, like 09:00", { isOptional: true }),
        p("location.name", "string", "Name of the place"),
        p("location.city", "string", "City"),
        p("isOnline", "boolean", "True when people join over video"),
        p("notes", "string", "Things to remember", { isArray: true, isOptional: true }),
      ],
    }),
  },
  {
    id: "sentiment",
    label: "Sentiment",
    samplePrompt: "The new update is really fast, but the battery now drains much quicker than before.",
    build: () => ({
      rootName: "Sentiment",
      properties: [
        p("label", "string", "One of: positive, negative, mixed, neutral"),
        p("score", "double", "From -1 (very negative) to 1 (very positive)"),
        p("reasons", "string", "Short phrases from the text that explain the label", { isArray: true }),
      ],
    }),
  },
];
