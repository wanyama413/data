import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = { title: "PitchData — CSV exporter", description: "Download PitchAPI football data as CSV files." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
