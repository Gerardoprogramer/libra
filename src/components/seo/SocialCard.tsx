import type { Locale } from "@/i18n/routing";

interface SocialCardProps {
  locale: Locale;
  title: string;
  authors?: string;
  cover?: string | null;
  book?: boolean;
}

function fitText(text: string, limit: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1).trimEnd()}…` : normalized;
}

export function SocialCard({ locale, title, authors, cover, book = false }: SocialCardProps) {
  const displayTitle = fitText(title, 150);

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#f7f4ee", color: "#20231f" }}>
      <div style={{ position: "absolute", inset: 20, border: "1px solid #ded9ce", display: "flex" }} />
      <div
        style={{
          width: 430,
          height: "100%",
          background: "#18392f",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 35,
            top: 35,
            width: 360,
            height: 560,
            display: "flex",
            border: "1px solid #476056",
          }}
        />
        <div
          style={{
            width: 286,
            height: 440,
            display: "flex",
            position: "relative",
            background: "#e8e0d0",
            borderRadius: 5,
            boxShadow: "12px 18px 30px #0a211b",
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {cover ? (
            // ImageResponse renders embedded bytes; next/image is for browser HTML.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" width={286} height={440} style={{ objectFit: "contain" }} />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                padding: 28,
                border: "10px solid #d4c8ad",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                color: "#283c33",
              }}
            >
              <svg width="86" height="86" viewBox="0 0 24 24" fill="none" stroke="#283c33" strokeWidth="1.2">
                <path d="M12 6C8 3 5 3 2 4v15c3-1 6-1 10 2 4-3 7-3 10-2V4c-3-1-6-1-10 2Zm0 0v15" />
              </svg>
              <div
                style={{
                  fontFamily: "Libra Serif",
                  fontSize: 29,
                  textAlign: "center",
                  lineHeight: 1.25,
                  marginTop: 28,
                }}
              >
                {book ? fitText(title, 70) : "Libra"}
              </div>
              <div style={{ height: 1, width: 60, background: "#89907b", marginTop: 26 }} />
              <div style={{ fontSize: 14, letterSpacing: 3, marginTop: 24 }}>LIBRA</div>
            </div>
          )}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: 770,
          padding: "52px 58px 48px",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#20231f" strokeWidth="1.5">
            <path d="M12 6C8 3 5 3 2 4v15c3-1 6-1 10 2 4-3 7-3 10-2V4c-3-1-6-1-10 2Zm0 0v15" />
          </svg>
          <div style={{ fontFamily: "Libra Serif", fontSize: 34 }}>Libra</div>
        </div>
        <div
          style={{ display: "flex", flexDirection: "column", padding: "24px 0", maxHeight: 370, overflow: "hidden" }}
        >
          <div style={{ fontSize: 15, letterSpacing: 3, color: "#556357", marginBottom: 22 }}>
            {locale === "es" ? "UNA BIBLIOTECA SIN FRONTERAS" : "A LIBRARY WITHOUT WALLS"}
          </div>
          <div
            style={{
              fontFamily: "Libra Serif",
              fontSize: displayTitle.length > 90 ? 37 : displayTitle.length > 48 ? 46 : 60,
              lineHeight: 1.14,
              letterSpacing: -1.5,
            }}
          >
            {displayTitle}
          </div>
          {authors && (
            <div style={{ fontSize: 25, lineHeight: 1.3, color: "#526057", marginTop: 24 }}>
              {fitText(authors, 110)}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            borderTop: "1px solid #d5d6ca",
            paddingTop: 24,
            color: "#465649",
            fontSize: 19,
          }}
        >
          {locale === "es" ? "Lee gratis en Libra" : "Read for free on Libra"}
          <span style={{ marginLeft: "auto", fontSize: 28 }}>→</span>
        </div>
      </div>
    </div>
  );
}
