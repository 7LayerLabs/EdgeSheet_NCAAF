import Image from "next/image";

/**
 * Player avatar: jersey number in the team color with the team logo tucked in
 * the corner. CollegeFootballData has no headshots, so this is the honest version.
 */
export function Avatar({
  jersey,
  color,
  logo,
  size = "md",
}: {
  jersey?: number | null;
  color: string;
  logo?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dim = size === "lg" ? "h-16 w-16 text-2xl" : size === "md" ? "h-12 w-12 text-lg" : "h-9 w-9 text-sm";
  const badge = size === "lg" ? "h-7 w-7 -right-1 -bottom-1" : size === "md" ? "h-5 w-5 -right-0.5 -bottom-0.5" : "h-4 w-4 -right-0.5 -bottom-0.5";
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center rounded-full ${dim}`} style={{ background: color }}>
      <span className="display font-extrabold text-white" style={{ textShadow: "0 1px 2px rgba(0,0,0,.6)" }}>
        {jersey ? `#${jersey}` : "–"}
      </span>
      {logo && (
        <span className={`absolute flex items-center justify-center rounded-full bg-ink ring-2 ring-ink ${badge}`}>
          <Image src={logo} alt="" width={28} height={28} className="h-[80%] w-[80%] object-contain" unoptimized />
        </span>
      )}
    </span>
  );
}
