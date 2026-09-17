import Image from "next/image";

export function BrandMark({
  size = 32,
  className = "",
  priority = false,
}: {
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/brand/hoodx-hat.png"
      alt="HOODX"
      width={size}
      height={size}
      priority={priority}
      className={`shrink-0 object-contain ${className}`}
    />
  );
}
