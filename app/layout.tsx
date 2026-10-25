import type { Metadata } from 'next';
export const metadata:Metadata={title:'KPCSTL 주보 스튜디오',description:'함께 편집하고 준비하는 세인트루이스 한인장로교회 주보'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="ko"><body>{children}</body></html>;}
