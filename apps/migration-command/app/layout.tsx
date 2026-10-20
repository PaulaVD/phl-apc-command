import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'PH-L · Migration Command',description:'Phoenix Legacy migration planning workspace'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
