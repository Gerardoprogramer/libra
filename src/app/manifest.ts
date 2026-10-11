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
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/libra-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/libra-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/libra-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
