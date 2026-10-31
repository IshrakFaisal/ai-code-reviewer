import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import type { AnalysisReport } from "@/lib/types";
import { readableReport } from "./readable-export";

export function reportPdfDefinition(
  report: AnalysisReport,
): TDocumentDefinitions {
  const document = readableReport(report);
  const content: Content[] = [
    { text: "VERIFICATION REPORT", style: "eyebrow" },
    { text: document.title, style: "title" },
    { text: document.subtitle, style: "subtitle" },
    { text: document.notice, style: "notice" },
    { text: document.metadata.join("\n"), style: "metadata" },
    ...document.sections.flatMap((section, sectionIndex): Content[] => [
      { text: section.title, style: "heading", headlineLevel: 1 },
      ...section.paragraphs.map((paragraph, paragraphIndex): Content => ({
        id: `report-paragraph-${sectionIndex}-${paragraphIndex}`,
        text: paragraph,
        margin: [0, 0, 0, 8],
      })),
    ]),
  ];
  return {
    info: {
      title: `PR #${report.pr.number} - ${document.title}`,
      author: "AI Change Verifier",
      subject: "Pull request verification report",
    },
    pageSize: "A4",
    pageMargins: [44, 50, 44, 48],
    defaultStyle: {
      font: "Roboto",
      fontSize: 10,
      lineHeight: 1.3,
      color: "#263449",
    },
    header: () => ({
      text: "AI CHANGE VERIFIER",
      margin: [44, 22, 44, 0],
      color: "#607086",
      fontSize: 8,
    }),
    footer: (page, pages) => ({
      columns: [
        { text: "Evidence informs the review. You make the decision." },
        { text: `${page} / ${pages}`, alignment: "right", width: 55 },
      ],
      margin: [44, 16, 44, 0],
      fontSize: 8,
      color: "#607086",
    }),
    styles: {
      eyebrow: {
        fontSize: 8,
        bold: true,
        color: "#456b91",
        margin: [0, 8, 0, 8],
      },
      title: {
        fontSize: 22,
        bold: true,
        lineHeight: 1.1,
        margin: [0, 0, 0, 8],
      },
      subtitle: { fontSize: 12, color: "#607086", margin: [0, 0, 0, 16] },
      notice: {
        fontSize: 10,
        bold: true,
        color: "#3b526f",
        margin: [0, 0, 0, 12],
      },
      metadata: { fontSize: 8, color: "#607086", margin: [0, 0, 0, 8] },
      heading: {
        fontSize: 13,
        bold: true,
        color: "#172b46",
        margin: [0, 16, 0, 8],
      },
    },
    pageBreakBefore: (node, following) =>
      (node.headlineLevel === 1 &&
        (following.length === 0 || (node.startPosition?.top ?? 0) > 680)) ||
      (node.id?.startsWith("report-paragraph-") === true &&
        typeof node.text === "string" &&
        node.text.length < 500 &&
        (node.pageNumbers?.length ?? 0) > 1),
    content,
  };
}

/** Load the PDF engine and bundled fonts only when an export is requested. */
export async function createReportPdf(report: AnalysisReport): Promise<Blob> {
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error("PDF generation timed out. Try Markdown or JSON instead."),
        ),
      45000,
    );
    try {
      // 0.2.23 exports the font map directly; older type definitions describe
      // the obsolete nested vfs shape. Pass the bundled map explicitly.
      const stream = pdfMake
        .createPdf(
          reportPdfDefinition(report),
          {},
          undefined,
          fonts as unknown as Record<string, string>,
        )
        .getStream();
      const chunks: BlobPart[] = [];
      stream.on("data", (chunk: Uint8Array) =>
        chunks.push(new Uint8Array(chunk)),
      );
      stream.on("error", (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });
      stream.on("end", () => {
        clearTimeout(timeout);
        resolve(new Blob(chunks, { type: "application/pdf" }));
      });
      stream.end();
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}
