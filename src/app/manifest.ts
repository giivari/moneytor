import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "moneytor",
    short_name: "moneytor",
    description: "Monitor keuangan pribadi yang privat",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#5044dc",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}

