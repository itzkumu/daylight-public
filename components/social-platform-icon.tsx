type Platform = "instagram" | "tiktok" | "facebook";

const tiktokNote = "M12.55 1h3.63c.21 3.19 2.27 5.53 5.48 5.76v3.67a9.18 9.18 0 0 1-5.48-1.77v6.51a7.02 7.02 0 1 1-6.03-6.96v3.74a3.35 3.35 0 1 0 2.4 3.22V1Z";

export default function SocialPlatformIcon({ platform, size = 22 }: { platform: Platform; size?: number }) {
  if (platform === "instagram") return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><defs><linearGradient id="daylight-instagram" x1="1" y1="23" x2="23" y2="1" gradientUnits="userSpaceOnUse"><stop stopColor="#FFCC55"/><stop offset=".38" stopColor="#F44A78"/><stop offset=".75" stopColor="#B63DDD"/><stop offset="1" stopColor="#6555E8"/></linearGradient></defs><rect x="1" y="1" width="22" height="22" rx="6.5" fill="url(#daylight-instagram)"/><rect x="5.4" y="5.4" width="13.2" height="13.2" rx="4.1" stroke="white" strokeWidth="1.7"/><circle cx="12" cy="12" r="3.15" stroke="white" strokeWidth="1.7"/><circle cx="17.15" cy="6.9" r="1" fill="white"/></svg>;
  if (platform === "tiktok") return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect width="24" height="24" rx="6" fill="#080B10"/><path d={tiktokNote} fill="#25F4EE" transform="translate(-.7 .55) scale(.91)"/><path d={tiktokNote} fill="#FE2C55" transform="translate(.7 -.15) scale(.91)"/><path d={tiktokNote} fill="white" transform="scale(.91)"/></svg>;
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect width="24" height="24" rx="6" fill="#1877F2"/><path d="M14.8 21v-7.35h2.47l.37-2.86H14.8V8.96c0-.83.23-1.39 1.42-1.39h1.51V5.01c-.26-.04-1.16-.11-2.21-.11-2.19 0-3.68 1.34-3.68 3.8v2.09H9.36v2.86h2.48V21h2.96Z" fill="white"/></svg>;
}
