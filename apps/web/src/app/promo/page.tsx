import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, Crown, Printer } from "lucide-react";

import styles from "./promo.module.css";

export const metadata: Metadata = {
  title: "공주는 편한 게 최고야 | Print-cess by Club Paradiso",
  description: "황궁에서도 결국 출력은 셀프. Print-cess의 로맨스 판타지 캠페인.",
};

const artworks = [
  {
    src: "/promo/royal/01-palace-princess.png",
    alt: "황궁에서 문서를 직접 출력하는 공주와 프린터",
    caption: "아니 황궁에 사람이 몇인데 공주가 직접 출력함",
    width: 1448,
    height: 1086,
  },
  {
    src: "/promo/royal/02-crown-prince.png",
    alt: "황태자에게 보낼 문서를 든 공주와 프린터",
    caption: "황태자 전하도 파일은 직접 보내셔야 합니다",
    width: 1448,
    height: 1086,
  },
  {
    src: "/promo/royal/03-save-the-empire.png",
    alt: "제국의 서류를 직접 출력하는 공주와 프린터",
    caption: "제국을 구하셔도 출력은 셀프입니다",
    width: 1448,
    height: 1086,
  },
  {
    src: "/promo/royal/04-paper-jam.png",
    alt: "용지가 걸린 프린터 앞에 선 공주",
    caption: "황태자는 됐고, 용지가 걸렸다고",
    width: 1448,
    height: 1086,
  },
] as const;

export default function RoyalPromoPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/promo" className={styles.brand}>
          <Printer aria-hidden="true" />
          <span>
            <strong>Print-cess</strong>
            <small>by Club Paradiso</small>
          </span>
        </Link>
        <Link href="/start" className={styles.serviceLink}>
          서비스로 돌아가기 <ArrowRight aria-hidden="true" />
        </Link>
      </header>

      <section className={styles.hero} aria-labelledby="royal-title">
        <Image
          className={styles.heroImage}
          src={artworks[2].src}
          alt={artworks[2].alt}
          fill
          priority
          sizes="100vw"
        />
        <div className={styles.heroVeil} />
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            <Crown aria-hidden="true" /> Royal self-service printing
          </p>
          <h1 id="royal-title">공주는 편한 게 최고야</h1>
          <p className={styles.heroLead}>황궁에서도 결국 출력은 셀프.</p>
          <div className={styles.heroActions}>
            <Link href="/start" className={styles.primaryCta}>
              지금 출력하기 <ArrowRight aria-hidden="true" />
            </Link>
            <a href="#royal-gallery" className={styles.secondaryCta}>
              황실 컬렉션 보기 <ArrowDown aria-hidden="true" />
            </a>
          </div>
        </div>
        <p className={styles.heroBrand}>Print-cess by Club Paradiso</p>
      </section>

      <section className={styles.gallery} id="royal-gallery" aria-labelledby="gallery-title">
        <div className={styles.sectionHeading}>
          <p>Royal incident archive · 01—04</p>
          <h2 id="gallery-title">황실 셀프 출력 사건집</h2>
        </div>
        <div className={styles.artworkList}>
          {artworks.map((artwork, index) => (
            <figure
              className={styles.artwork}
              data-position={index % 2 === 0 ? "left" : "right"}
              key={artwork.src}
            >
              <div className={styles.artworkFrame}>
                <Image
                  src={artwork.src}
                  alt={artwork.alt}
                  width={artwork.width}
                  height={artwork.height}
                  sizes="(max-width: 720px) 92vw, (max-width: 1100px) 82vw, 1050px"
                />
              </div>
              <figcaption>
                <span>0{index + 1}</span>
                {artwork.caption}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className={styles.decree} aria-labelledby="decree-title">
        <Crown aria-hidden="true" />
        <p>Imperial decree № PC–11</p>
        <h2 id="decree-title">황실 인쇄 칙령</h2>
        <div className={styles.decreeCopy}>
          <p>파일은 직접 보내주세요.</p>
          <p>출력은 셀프입니다.</p>
          <p>용지가 걸렸다면 황태자보다 프린터를 먼저 봐주세요.</p>
        </div>
        <small>무료 출력은 한 번에 11페이지까지. 12~50페이지는 직원 승인이 필요합니다.</small>
      </section>

      <section className={styles.reality} aria-labelledby="reality-title">
        <div className={styles.realityIntro}>
          <p>Back to reality</p>
          <h2 id="reality-title">
            농담은 여기까지.
            <br />
            출력은 진짜 간단하게.
          </h2>
        </div>
        <ol className={styles.steps}>
          <li>
            <span>01</span>
            <div>
              <h3>키오스크의 QR을 찍어요</h3>
              <p>휴대전화로 현재 출력 세션에 연결합니다.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>파일을 직접 골라 보내요</h3>
              <p>사진, PDF와 키오스크가 지원하는 한글 문서를 선택합니다.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>미리 보고 한 번 출력해요</h3>
              <p>순서와 문서를 확인한 뒤 셀프 출력합니다.</p>
            </div>
          </li>
        </ol>
      </section>

      <section className={styles.actual} aria-labelledby="actual-title">
        <div>
          <p className={styles.actualKicker}>Actual Print-cess</p>
          <h2 id="actual-title">계정 없이, 휴대전화에서, 공용 프린터로.</h2>
        </div>
        <p>
          문서를 공용 PC에 로그인해 남겨둘 필요 없이 현재 세션으로 전송합니다. 출력이 끝나면 다음
          사람을 위한 새 세션이 시작됩니다.
        </p>
      </section>

      <section className={styles.finalCta} aria-labelledby="final-title">
        <div>
          <p>Happily ever after, but with paperwork.</p>
          <h2 id="final-title">
            공주든 아니든,
            <br />
            출력은 편한 게 최고니까.
          </h2>
        </div>
        <Link href="/start" className={styles.finalButton}>
          Print-cess 사용하기 <ArrowRight aria-hidden="true" />
        </Link>
      </section>

      <footer className={styles.footer}>
        <strong>Print-cess by Club Paradiso</strong>
        <span>Secure self-service document printing</span>
      </footer>
    </main>
  );
}
