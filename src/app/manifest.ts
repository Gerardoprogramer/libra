import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Libra",
    short_name: "Libra",
    description: "Libros para leer gratis · Books to read for free",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // The site's paper color, the same as the layout's viewport themeColor (the sRGB value of --background in
    // globals.css), so the installed app's splash screen and title bar match its pages.
    background_color: "#fcfaf6",
    theme_color: "#fcfaf6",
    icons: [
      { src: "/icons/libra-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/libra-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/libra-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
