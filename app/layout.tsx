import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AMI Affordability Map",
  description:
    "Look up Area Median Income and housing affordability by Census tract",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossOrigin=""
        />
      </head>
      <body className="antialiased bg-gray-100">{children}</body>
    </html>
  );
}
