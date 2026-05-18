import type { ToolDefinition } from "./types";

async function getWeather(city: string) {
  console.log("执行天气工具:", city);

  await new Promise((resolve) => setTimeout(resolve, 1500));

  return {
    city,
    temperature: 26,
    weather: "晴天",
  };
}

export const weatherTool: ToolDefinition = {
  name: "get_weather",
  description: "Get weather information for a city",
  source: "local",
  permissions: ["read"],
  parameters: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description: "City name",
      },
    },
    required: ["city"],
  },
  async execute(args) {
    const city = args.city;

    if (typeof city !== "string") {
      throw new Error("Tool get_weather requires a string city");
    }

    return getWeather(city);
  },
};
