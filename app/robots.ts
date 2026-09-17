import { SITE_URL } from "@/lib/config";

export default function robots() {
  return {
    rules: { userAgent: "*", allow: "/" },
    host: SITE_URL,
  };
}
