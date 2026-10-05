# Goblin — สเปกสำหรับ v0.0.1

สถานะ: ผู้ใช้อนุมัติเริ่ม v0.0.1 วันที่ 2026-10-05; implementation และการตรวจรับดำเนินการตามข้อกำหนดที่แก้ไขร่วมกัน

ชื่อโปรเจกต์: **Goblin**
คำสั่งหลัก: `goblin`
Tagline: “Your little skill keeper.”
คาแรกเตอร์: เจ้าก็อบลินประจำเครื่อง คอยดูแลคลังสกิลของ AI

## เป้าหมายและขอบเขต

ผู้ใช้ต้องการลดความรกของ AI skills โดยสั่งผ่าน Codex, Claude Desktop และ CLI เริ่มใช้เองบน Mac ก่อน และเตรียมแพ็กให้ผู้อื่นติดตั้งได้ภายหลัง

สมมติฐานที่เสนอ: ทำงานในเครื่อง ไม่ต้องมีบัญชีหรือบริการ cloud; Claude Desktop เป็นช่องทางเรียกเครื่องมือผ่าน MCP ส่วนการจัดการสกิลที่อัปโหลดไว้ใน Claude บน cloud อยู่นอก v0.1

ความสำเร็จ: ผู้ใช้ดูแหล่งที่มาของสกิล ตรวจรายการซ้ำ ปิดสกิลใน Codex เก็บพักสกิลที่ติดตั้งเอง และกู้คืนได้ โดย CLI และ MCP ให้ผลจากแกนเดียวกัน

ข้อกำหนดหลักจากผู้ใช้: Goblin ต้องไม่ทำให้ context/token ของสกิลอื่นเพิ่มขึ้น การใช้ MCP หรือเรียก CLI ผ่าน agent อาจมีต้นทุนของ Goblin เอง ต้องแยกต้นทุนนี้และไม่อ้างว่า context รวมเป็นศูนย์

## ทางเลือก

1. CLI + local MCP ใช้แกนร่วมกัน — แนะนำ เพราะครอบคลุมทุกช่องทางที่ขอ และใช้ทดสอบบนเครื่องนี้ได้โดยตรง
2. CLI อย่างเดียว — เริ่มเล็กกว่า แต่ Claude Desktop ยังเรียกผ่านเครื่องมือมาตรฐานไม่ได้
3. Desktop GUI + CLI + MCP — ดูรายการสะดวก แต่เพิ่มภาระสร้างและแจกแอป; เก็บไว้หลังพิสูจน์ workflow รุ่นแรก

## โครงสร้างที่เสนอ

TypeScript บน Node.js; แพ็ก npm สำหรับ CLI และ local MCP แบบ stdio ในแพ็กเดียวกัน ชื่อแพ็กที่จะเผยแพร่ต้องตรวจความว่างภายหลัง ชื่อคำสั่งที่เลือกคือ `goblin`; ยังไม่ได้ตรวจชื่อซ้ำบน npm/GitHub

- core: scan, inspect, audit, plan, apply, restore และ history
- adapters: จำแนกแหล่งติดตั้ง ความสามารถในการปิด และข้อจำกัดแต่ละ provider
- CLI: แสดงผลแบบข้อความ และ `--json` สำหรับ automation
- MCP: `list_skills`, `inspect_skill`, `audit_skills`, `plan_change`, `apply_change`, `restore_change`
- state: config, แผนเปลี่ยนแปลง, journal และ archive ใน user data directory ของเครื่องมือนี้

`tidy` ตรวจและเสนอรายการเท่านั้น; การเก็บพักเกิดผ่าน `stash` ไม่เกิดจากการตรวจโดยอัตโนมัติ

MCP และ CLI เรียก service functions เดียวกัน ไม่เรียก shell จากข้อความที่โมเดลส่งมา ไม่จำเป็นต้องมี LLM API key เพื่อ scan/audit

## ข้อกำหนดด้าน context และ token

- ไม่เพิ่มข้อความ, frontmatter, wrapper, dependency หรือคำสั่งเรียก Goblin เข้า SKILL.md, resources, AGENTS.md หรือ CLAUDE.md ของสกิล/โปรเจกต์อื่น ไม่ติดตั้ง Goblin เป็นสกิลที่ถูกโหลดทุกงานโดยอัตโนมัติ
- ไม่เพิ่ม hooks ที่ส่งรายการสกิล รายงาน หรือประวัติเข้า prompt ทุก turn; ทำงานเฉพาะเมื่อผู้ใช้เรียก CLI หรือเครื่องมือ MCP
- Scan, parse, fingerprint, duplicate checks และการทำ reference graph ทำด้วยโปรแกรมในเครื่อง ไม่ส่งเนื้อหา SKILL.md หรือ resources ทั้งชุดให้ LLM และไม่ใช้ LLM API ภายใน core
- Cache/index/journal/archive เก็บนอก discovery roots ของทุก provider; ไม่สร้าง skill สำเนาที่ AI จะค้นพบ และไม่เพิ่ม discovery entries ในการติดตั้ง/scan/tidy/disable/stash
- MCP มี tool definitions คงที่และสั้นตาม operation ไม่สร้าง tool/resource/prompt หนึ่งตัวต่อหนึ่งสกิล ไม่เผยแพร่ catalog สกิลเป็น injected context
- MCP ส่งเฉพาะ metadata ที่จำเป็น: ID, ชื่อ, source/status, reason code และรายการผลกระทบ inspect ส่ง metadata เท่านั้น ไม่ส่ง skill body โดยอัตโนมัติ
- MCP list/audit/history ใช้ pagination ค่าเริ่มต้นไม่เกิน 20 รายการ และ response แต่ละหน้าจำกัด 8 KiB UTF-8; ข้อมูลส่วนที่ไม่ครบต้องมี cursor/flag ชัดเจน แผนเปลี่ยนแปลงยาวให้แบ่งหน้า หรือบันทึกไฟล์สำหรับตรวจในเครื่อง ห้ามตัดข้อมูลผลกระทบแล้วอ้างว่าแสดงครบ
- CLI แบบเรียกตรงใน terminal ไม่ต้องผ่านโมเดล; โหมด summary เป็นค่าเริ่มต้น ส่วน output แบบเต็มต้องร้องขอ และหาก agent อ่าน output นั้นจะมีต้นทุน context ของการเรียกนั้น
- Enable/restore อาจทำให้สกิลที่ผู้ใช้เลือกกลับมาถูกค้นพบอีกครั้ง นี่คือผลที่ตั้งใจของคำสั่ง; ต้องไม่สร้าง alias ใหม่หรือเพิ่ม payload ของสกิลอื่นที่ไม่ได้เลือก
- ไม่สัญญาว่า token รวมลดลงเสมอหรือ MCP overhead เป็นศูนย์; ผลจริงขึ้นกับ client, model, tool discovery และการนำ output เข้า context ของ host

## แหล่งข้อมูลและ identity

ตรวจ `~/.agents/skills`, `~/.claude/skills`, legacy `~/.codex/skills` และ root ที่ผู้ใช้ระบุ สำหรับ project scope ให้ผู้ใช้ระบุ project; ไม่สแกนทุกโฟลเดอร์ใน home โดยอัตโนมัติ

แยก physical skill ออกจาก discovery entry: รายการหนึ่งต้องมี ID, path ที่พบ, canonical path, provider/scope, ชื่อจาก frontmatter, link target และ capability ที่รองรับ

Symlink ที่ชี้ไปยัง canonical skill เดียวกันเป็น shared reference ไม่ใช่ duplicate ชื่อเหมือนกันยังไม่พิสูจน์ว่าเนื้อหาเหมือนกัน Audit เปรียบเทียบ fingerprint ทั้งไฟล์และทรัพยากรใน skill โดยไม่รัน scripts และไม่อ่านไฟล์นอกขอบเขตที่กำหนดผ่าน symlink

การสแกนมีขีดจำกัด depth/จำนวนไฟล์ ตรวจวงจร symlink และรายงาน broken links/permission errors ต่อรายการ โดยยังแสดงรายการที่อ่านได้

Plugin cache, system skills และแหล่งที่มี sync manifest เป็น managed sources: ตรวจและรายงานได้ แต่ไม่ย้ายหรือลบใน v0.1 แหล่งที่ไม่ทราบ ownership ใช้ read-only จนผู้ใช้กำหนดว่าเป็น manual source

## การทำงานรุ่นแรก

คำสั่งที่เสนอ:

```text
goblin scan [--project PATH] [--json]
goblin list [--provider codex|claude-code] [--json]
goblin inspect ID
goblin tidy [--json]
goblin remove NAME_OR_ID [--dry-run]
goblin disable ID --provider codex --dry-run
goblin disable ID --provider codex
goblin enable ID --provider codex
goblin stash ID --dry-run
goblin stash ID
goblin restore CHANGE_ID --dry-run
goblin restore CHANGE_ID
goblin history
goblin mcp
goblin setup codex|claude-desktop --print
```

`remove NAME_OR_ID` เป็นคำสั่งง่ายสำหรับนำ manual skill ออกจากการใช้งาน ใช้กลไก stash/archive และ journal เดียวกัน เก็บไว้ในที่กู้คืนได้ ส่งกลับ change ID สำหรับ `goblin restore CHANGE_ID` ไม่มีการลบถาวรใน v0.1 หากชื่อซ้ำหรืออ้างถึงหลาย physical skills ให้แสดง IDs และหยุดโดยไม่เลือกแทนผู้ใช้ การลบสกิลร่วมต้องรวมการจัดการ references ที่เกี่ยวข้องในแผนและรายงานแอปที่ได้รับผลกระทบ managed sources ใช้ข้อจำกัดเดิม ไม่ลบ plugin cache ผ่านคำสั่งนี้

`scan` สำรวจแล้วแสดงรายละเอียดสกิลทันทีในตารางเดียว ไม่ต้องเรียกคำสั่งสถิติแยก คอลัมน์หลักคือ `id`, `name`, `path`, `source`, `status`, `last_used_at` และ `usage_count` โดย ID ต้องคงที่สำหรับ discovery entry เดิม path เป็น absolute discovery path และ shared references ต้องแสดง canonical path ในรายละเอียดที่ขยายได้ CLI แสดงวันเวลาตาม timezone ของผู้ใช้พร้อม offset ส่วน JSON ใช้ ISO 8601 พร้อม timezone

เวลาการใช้งานหมายถึงเวลาที่มีหลักฐานว่า AI เรียกสกิล (`last_used_at`) ไม่ใช่ mtime/atime หรือเวลาที่ Goblin สแกน (`scanned_at` แสดงแยกในข้อมูลการสแกน) จำนวนครั้งและเวลามาจาก usage adapters/import ที่รองรับ พร้อม `usage_source`, `observation_start`, `observation_end` และ coverage ในรายละเอียด/JSON การเปรียบเทียบจำนวนครั้งทำได้เฉพาะ coverage ที่เทียบกันได้

ไม่มีหลักฐานให้แสดง `ไม่ทราบ` ในตาราง และ `null` ใน JSON ไม่ตีความเป็นศูนย์หรือไม่เคยใช้ แหล่งข้อมูลที่ไม่รองรับให้รายงานว่าไม่มีข้อมูล ไม่มี prompt hooks หรือการแก้สกิลอื่นเพื่อเก็บสถิติใน v0.1 CLI แสดงผลตาม path อย่างคงที่ ส่วน MCP scan/list ใช้ pagination และขีดจำกัด response ตามข้อกำหนดด้าน context

การเก็บสถิติของคำสั่ง Goblin เองไม่ใช่จำนวนครั้งที่ AI เรียก skill รุ่นแรกจะไม่รับคำสั่งลบอันดับต่ำสุดอัตโนมัติ: ผู้ใช้ดูผล scan แล้วระบุ NAME_OR_ID ที่ต้องการเอาออก ผลการลบสกิลในแชตต้องบอกว่าเก็บไว้กู้คืนและแสดง change ID อย่างกระชับ

`disable/enable --provider codex` แก้เฉพาะ skills.config ของ skill path ที่เลือก รักษา config ส่วนอื่น และสำรองก่อนเปลี่ยน รายงานว่าต้อง restart Codex การปิด discovery entry หนึ่งต้องไม่อ้างว่าปิดทุก alias หรือทุกแอปแล้ว

`stash` ย้าย manual skill ออกจาก discovery root ไป archive พร้อมบันทึกที่มา การเก็บพัก canonical skill ที่มี references จากหลาย root ต้องแสดง reference graph และทำเป็นรายการเปลี่ยนแปลงชุดเดียว เก็บข้อมูล symlink เดิมไว้เพื่อกู้คืน ห้ามปล่อยลิงก์เสียโดยเงียบ ๆ

v0.1 ไม่รับประกัน native disable เฉพาะ Claude Desktop skills บน cloud หรือ Claude Code config; รายงาน capability ตาม adapter และใช้ archive เฉพาะ local manual skills ที่รองรับ

`tidy` แสดง exact duplicate, same-name conflict, shared reference, broken link และ metadata ที่ผิดรูป ไม่สรุปว่าสกิลไม่เคยใช้จาก mtime/atime และไม่ลบอัตโนมัติ ข้อมูลการใช้จริงเป็น `unknown` จนมีแหล่ง evidence ที่รองรับ

## การเปลี่ยนแปลงและกู้คืน

ทุก mutation สร้างแผนที่มี path/ผลกระทบ/fingerprint ก่อน apply; `--dry-run` ไม่เปลี่ยน skill/config/history MCP ส่ง plan ID กลับมาแล้ว apply เฉพาะแผนที่เรียก ไม่สร้างการเปลี่ยนแปลงเพิ่มจากข้อความใน SKILL.md

ล็อก state ร่วมกันระหว่าง CLI และ MCP ตรวจว่าไฟล์ยังตรงกับ fingerprint ก่อน apply ถ้าเปลี่ยนแล้วให้สร้างแผนใหม่ เขียน state/config ผ่าน temporary file + rename และใช้ journal เพื่อรับมือ interruption การย้ายข้าม filesystem ต้อง copy + verify ก่อนย้ายต้นฉบับออก พร้อมเก็บหลักฐานสำหรับ recovery

Restore ไม่เขียนทับไฟล์ใหม่ที่ตำแหน่งเดิม; ถ้ามี conflict ให้หยุดและแสดงตำแหน่ง archive เดิม ข้อผิดพลาดใช้รหัสอ่านได้ เช่น STALE_PLAN, RESTORE_CONFLICT, MANAGED_SOURCE, PERMISSION_DENIED และ RECOVERY_REQUIRED

ไม่มี permanent delete ใน v0.1 การติดตั้งเครื่องมือไม่เปลี่ยนสกิลที่มีอยู่ setup แสดง config/คำสั่งเชื่อมต่อให้ตรวจได้ก่อน และใช้ absolute executable path เพื่อรองรับ desktop environment ที่ PATH ต่างจาก terminal

## การตรวจรับ

- Fixtures ครอบคลุม manual skill, plugin/synced source, shared symlink, broken link, ชื่อซ้ำ และเนื้อหาซ้ำ
- ปิด Codex entry แล้ว enable คืนได้ โดย config ส่วนอื่นยังเหมือนเดิม
- Archive/restore ได้เนื้อหาและ symlink เดิม; dry-run ไม่มีผลข้างเคียง
- Restore conflict, stale plan, mutation พร้อมกัน และ interrupted operation ไม่ทำให้ข้อมูลสูญหาย
- remove ใช้กลไก stash เดียวกันและ restore กลับได้ ชื่อกำกวมต้องไม่เปลี่ยนไฟล์; scan แสดงรายละเอียดทันที โดย usage ที่ไม่มีหลักฐานเป็น unknown/null และไม่ใช้ file timestamps แทน usage ตรวจ timezone และแยก last_used_at ออกจาก scanned_at
- CLI และ MCP ผ่าน integration test บน temporary roots และคืนผลสอดคล้องกัน
- เปรียบเทียบ file hashes/ขนาดและ discovery entries ก่อน–หลัง: เนื้อหา/metadata ของสกิลอื่นต้องไม่เปลี่ยน ไม่มี wrappers, hooks หรือ instructions เพิ่ม; enable/restore คืนเฉพาะรายการที่เลือก
- Fixtures จำนวนมากต้องไม่ทำให้ MCP tool definitions โตตามจำนวนสกิล และ response ต้องผ่านขีดจำกัด bytes/pagination โดยไม่เผย skill body
- รายงานขนาด tool definitions/output เป็น bytes แยกจาก payload สกิล; แสดง token count เฉพาะเมื่อมี tokenizer ของ model หรือ usage metrics จาก host ห้ามใช้ byte count อ้างเป็น token จริง
- ทดสอบ MCP จริงใน Codex และ Claude Desktop ก่อนระบุว่าการเชื่อมต่อได้รับการยืนยัน
- ทดลองกับสกิล manual ที่ผู้ใช้เลือกหลังผ่าน fixture tests; sandbox permissions ของ host ยังมีผลตามปกติ

## เส้นทางแจก

v0.1 ทดลองใช้บน macOS พร้อม README การติดตั้ง/เชื่อมต่อ/กู้คืน และทดสอบ tarball ด้วย npm pack ก่อนแจก มี English help text และเอกสารไทยสำหรับการทดลองในเครื่องนี้

หลังใช้งานจริง: profiles ตามงาน (คำสั่งที่เสนอ `goblin load coding`), provider-native adapters เพิ่มเติม, Windows/Linux validation, desktop extension packaging และ telemetry การใช้แบบ opt-in ไม่มี GUI, cloud sync, marketplace หรือการเผยแพร่ npm/GitHub ในงานขั้นนี้

## หลักฐานและข้อจำกัด

ตรวจเครื่องวันที่ 2026-10-05: มี root ทั้งสามข้างต้น และ Firecrawl หลาย entry ใน ~/.claude/skills เป็น symlink ไป ~/.agents/skills จึงต้องรักษา shared references

- Codex local skills, symlink discovery และ skills.config: https://developers.openai.com/codex/skills/
- Codex local stdio MCP: https://developers.openai.com/codex/mcp/
- Claude Desktop local MCP: https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop

เอกสารรองรับแนวทางการเชื่อมต่อ แต่ยังไม่ได้ยืนยัน runtime integration ในเครื่องนี้ ไม่มีการแก้สกิลหรือ config ปัจจุบันระหว่างจัดทำร่างนี้
