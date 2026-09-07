# Homepage launch film

## Scope and activation contract

`MarketingVideo` is registered in the existing style guide and inserted after the cloud homepage's hero/setup, before Examples. It uses current tokens, a centered maximum 780px frame and a reserved 4:3 ratio. No hero/CTA/icon, admin, canonical template, authentication, billing, CSP, launch-flag, Nginx or deployment-script change accompanies it.

The server emits **no video/source/track src**. The default Watch action is an ordinary link to the optimized phone MP4; the small page-specific script replaces that link with a native button. Idle, scroll, hover and focus never attach movie URLs. Explicit activation selects one rendition using the actual frame CSS width: at most 480px gets phone, wider gets desktop. The choice remains pinned across resize/fullscreen/retry. High DPR intentionally does not force a heavier phone movie; this is a transfer-quality tradeoff, not a pixel-for-pixel retina promise.

The image is a responsive picture, not a second video poster request. Its `sizes` reflect existing 16/24px gutters, and high-DPR phones may choose the 960px still (34,330 bytes, still below the 40KB phone target). Only one still is requested. It is eager because actual opening viewport LCP probes identified it as an LCP candidate. Width/height and aspect ratio reserve geometry.

Native controls, playsinline, unmuted audio after activation, focus transfer, pause/seek/fullscreen/volume and a visible retry/open-file path are retained. A rejected play promise or failed request exposes a focused retry; no automatic second movie downloads. A pending 15-second deadline offers retry, rather than promising that every connection will load. The action/status area reserves space without changing the action label. No autoplay, loop, player library, HLS, prefetch or third-party request is introduced.

## Exact media provenance

Selected master: `agent-artifacts-v5-new-master.mp4`, SHA-256 `306f87df1bec707d4027d395db10f7ec4ee6421d6aa3f17ca641df90ad1983bb`, 1440×1080, 60fps, 46 seconds. The original master/compact/audio and production render directories are not included in this repository change.

Frozen media bundle: `74b35dc950f75030c6722e929f97cd3997a879340885f19a2cf9968373260e7e`. The first four files below are exact media-worker delivery bytes. The fifth is an authored, 840-byte timed visual alternative derived from that delivery's factual visual transcript; it is not a re-encoded movie, narration, or invented sound captions.

| File in `public/assets/media/` | Bytes | Full SHA-256 |
|---|---:|---|
| `agent-artifacts-demo-desktop.eccb5261ce8a945e.mp4` | 4,122,608 | `eccb5261ce8a945ef779ecb2575241ddd9f7d615cddce7cb99a2c6451df14cd1` |
| `agent-artifacts-demo-phone.debfd582ad844195.mp4` | 2,843,251 | `debfd582ad844195d4af3a7cb8321f563edf16c23afc457588785066f0f75075` |
| `agent-artifacts-demo-poster-480.83c10656873f7de8.webp` | 14,528 | `83c10656873f7de8c2f3b52609f8c23d51c7c63557a0b4b144f30db297d2be88` |
| `agent-artifacts-demo-poster-960.13ccf9f3467fcdd8.webp` | 34,330 | `13ccf9f3467fcdd8177563613b8771e854ccc70852208bf5ff0e1691979979bb` |
| `agent-artifacts-demo-transcript.89c7595fab39d9ee.vtt` | 840 | `89c7595fab39d9ee48d8f8171e25510fd73f7af236a51b4760f0cc288bc5934f` |

Both movies are H.264 High / yuv420p, 60fps, 46s, 2,760 frames, with a single AAC stereo 48kHz encode of the selected lossless new mix. Desktop: 960×720, direct-master CRF22/slow, maximum keyframe gap 2s. Phone: 720×540, exact original compact picture-packet copy, maximum keyframe gap approximately 4.167s. Both are faststart (`moov` before `mdat`). The 30fps desktop trial saved only 4.6%; retaining finer motion was preferred. The phone picture-copy was smaller than a fresh 30fps encode, without an extra picture generation.

The 6.9-second posters retain the complete “From a reply. To a real page.” frame. No new crop, image generation or film encoding was performed by the product integrator.

### Reproduction recipe (archival inputs, not part of build)

The media worker used FFmpeg; the commands below preserve its selected options. Supply the selected original files as `master.mp4`, `compact.mp4` and `new-mix.wav` in a disposable working directory. Do not replace originals. Exact delivery hashes, rather than cross-version encoder determinism, are the adoption gate.

```sh
ffmpeg -i new-mix.wav -map 0:a:0 -c:a aac -b:a 128k -ar 48000 -ac 2 -t 46 -movflags +faststart audio128.m4a
ffmpeg -i master.mp4 -i audio128.m4a -map 0:v:0 -map 1:a:0 -vf 'scale=960:720:flags=lanczos:in_range=tv:out_range=tv,fps=60,setsar=1' -c:v libx264 -preset slow -crf 22 -threads 4 -pix_fmt yuv420p -profile:v high -g 120 -color_range tv -colorspace smpte170m -color_primaries bt709 -color_trc bt709 -c:a copy -t 46 -movflags +faststart desktop.mp4
ffmpeg -i compact.mp4 -i audio128.m4a -map 0:v:0 -map 1:a:0 -c copy -t 46 -movflags +faststart phone.mp4
ffmpeg -ss 6.9 -i master.mp4 -frames:v 1 -vf 'scale=480:360:flags=lanczos' -c:v libwebp -lossless 0 -quality 86 -compression_level 6 poster480.webp
ffmpeg -ss 6.9 -i master.mp4 -frames:v 1 -vf 'scale=960:720:flags=lanczos' -c:v libwebp -lossless 0 -quality 86 -compression_level 6 poster960.webp
```

The optional native “Visual transcript (English)” track and the always-available native details describe five visual sequences. They explicitly do not transcribe speech. The source production notes describe music/SFX, not narration. Objective audio decoding/alignment/no-clipping checks were supplied, but **no perceptual audio audition is claimed**.

## Static HTTP contract

Files follow the existing same-origin `/assets/` convention and are included by the existing package/Docker copy. No new static service or Nginx alias is needed: the existing static adapter provides real byte-range streams. Successful content-hashed MP4/WebP/VTT responses alone get one-year immutable caching. MP4 full/HEAD responses advertise byte ranges; partial responses retain exact 206 Content-Range/length. VTT receives `text/vtt; charset=utf-8` (the adapter's default octet-stream is not adequate for a native track). Missing/416 responses and unhashed files do not receive immutable caching. Homepage cache policy and CSP/sandbox policies remain unchanged.

Only selected delivery files are committed. Generated CSS/JS filenames and manifest remain the existing build's responsibility. A content change must create a new media hash/path; never overwrite an immutable URL.

## Regression and rollout boundaries

Scoped unit/integration/browser tests cover passive absence, progressive links, one rendition, failure/policy rejection with retry, native focus/keyboard timeline, exact hashes/faststart, WebVTT parsing, and HTTP range/cache/MIME positive and negative cases. Full existing suites remain required.

Local throughput checks use actual loopback HTTP with browser network emulation, not request fulfillment. They are reproducible lab measurements, not deployed-CDN or physical-device promises. Chromium is the verified engine; Safari/iOS/Firefox and perceptual audio listening remain unverified. Reserved-frame activation CLS is measured separately from initial font swaps in the unchanged page shell; do not claim global page CLS is zero.

Deployment is a separately reviewed operation using the existing guarded production script. Before enabling page references, verify all five media files and hashes exist in the checked-out static root; the existing checkout-before-build-before-reload order provides this ordering. Verify public full hashes, both real ranges, WebVTT MIME, built script/CSS identity, and anonymous click-to-play behavior afterward. Keep the existing live homepage flag unchanged. Rollback is an auditable scoped revert plus the same guarded deploy, not an environment flip or routine database restore. Preserve old content-hashed files while previously served references can remain cached.
