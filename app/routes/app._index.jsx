import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const db = (await import("../db.server")).default;

  const { session } = await authenticate.admin(request);

  // Get history from the last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const history = await db.exportHistory.findMany({
    where: {
      shop: session.shop,
      createdAt: {
        gte: sevenDaysAgo,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      filename: true,
      originalFilename: true,
      rowCount: true,
      createdAt: true,
    },
  });

  return { history };
};

export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const db = (await import("../db.server")).default;
  const { createExport } = await import("../../scripts/create-export");
  const { Buffer } = await import("node:buffer");

  const { session } = await authenticate.admin(request);

  const formData = await request.formData();
  const actionType = formData.get("actionType");

  // Handle download from history
  if (actionType === "download") {
    const historyId = formData.get("historyId");

    const historyItem = await db.exportHistory.findUnique({
      where: { id: historyId },
    });

    if (!historyItem || historyItem.shop !== session.shop) {
      return { success: false, error: "Export not found" };
    }

    return {
      success: true,
      filename: historyItem.filename,
      buffer: Array.from(historyItem.fileBuffer),
      rowCount: historyItem.rowCount,
      fromHistory: true,
    };
  }

  // Handle new file upload
  const productFile = formData.get("productFile");

  if (!productFile) {
    return {
      success: false,
      error: "No file provided",
    };
  }

  // Convert the uploaded file to a buffer
  const arrayBuffer = await productFile.arrayBuffer();
  const fileBuffer = Buffer.from(arrayBuffer);

  // Use createExport to process the file
  const result = createExport({
    file: fileBuffer,
    filename: productFile.name,
  });

  // Save to history if successful
  if (result.success && result.buffer) {
    await db.exportHistory.create({
      data: {
        shop: session.shop,
        filename: result.filename,
        originalFilename: productFile.name,
        rowCount: result.rowCount,
        fileBuffer: result.buffer,
      },
    });

    // Delete exports older than 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    await db.exportHistory.deleteMany({
      where: {
        shop: session.shop,
        createdAt: {
          lt: sevenDaysAgo,
        },
      },
    });

    return {
      ...result,
      buffer: Array.from(result.buffer),
    };
  }

  return result;
};

export default function Index() {
  const { history } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [file, setFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(Date.now());

  useEffect(() => {
    if (fetcher.data?.success) {
      const message = fetcher.data.fromHistory
        ? `Downloaded: ${fetcher.data.filename}`
        : `Export created: ${fetcher.data.filename} (${fetcher.data.rowCount} rows)`;

      shopify.toast.show(message);

      // Convert array back to Uint8Array for blob
      const uint8Array = new Uint8Array(fetcher.data.buffer);

      // Trigger download of the exported file
      const blob = new Blob([uint8Array], {
        type: fetcher.data.filename.endsWith(".xlsx")
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fetcher.data.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Clear file input after successful export (not from history)
      if (!fetcher.data.fromHistory) {
        setFile(null);
        setFileInputKey(Date.now());
      }
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const handleFileChange = (event) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      setFile(files[0]);
    }
  };

  const handleFileTransfer = () => {
    if (!file) {
      shopify.toast.show("Please select a file first", { isError: true });
      return;
    }
    const formData = new FormData();
    formData.append("productFile", file);
    formData.append("actionType", "upload");
    fetcher.submit(formData, { method: "POST", encType: "multipart/form-data" });
  };

  const handleDownloadFromHistory = (historyId) => {
    const formData = new FormData();
    formData.append("actionType", "download");
    formData.append("historyId", historyId);
    fetcher.submit(formData, { method: "POST" });
  };

  return (
    <s-page heading="Goossens Product Exporter">
      <s-section heading="Product Export">
        <s-paragraph>
          This application converts and exports product data to Goossens&apos; format.
          Files are automatically saved to history for 7 days.
        </s-paragraph>
      </s-section>

      <s-section heading="File Upload">
        <s-stack vertical spacing="loose">
          <s-text>Upload your product file (XLSX or CSV format)</s-text>
          <div style={{
            padding: '1rem 0',
            border: '1px solid var(--p-color-border)',
            borderRadius: 'var(--p-border-radius-200)',
            backgroundColor: 'var(--p-color-bg-surface)'
          }}>
            <input
              key={fileInputKey}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={handleFileChange}
              style={{
                width: '100%',
                padding: '0.5rem',
                marginBottom: '0.5rem',
                fontSize: '14px',
                cursor: 'pointer',
                border: '1px solid #c4cdd5',
                borderRadius: '4px'
              }}
            />
            {file && (
              <s-text variant="bodySm" style={{ marginTop: '0.5rem', display: 'block', fontWeight: '500' }}>
                Selected: {file.name}
              </s-text>
            )}
          </div>
          <s-button
            onClick={handleFileTransfer}
            variant="primary"
            loading={fetcher.state === "submitting"}
          >
            Transfer
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Export History (Last 7 Days)">
        {history.length === 0 ? (
          <s-text>No exports yet. Upload a file to get started.</s-text>
        ) : (
          <div style={{
            maxHeight: '400px',
            overflowY: 'auto',
            paddingRight: '0.5rem'
          }}>
            <s-stack vertical spacing="tight">
              {history.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: '1rem',
                    border: '1px solid var(--p-color-border)',
                    borderRadius: 'var(--p-border-radius-200)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: 'var(--p-color-bg-surface)',
                  }}
                >
                  <div style={{ flex: 1, gap: '0.5rem', flexDirection: 'column', display: 'flex' }}>
                    <s-text variant="bodyMd" fontWeight="semibold">
                      {item.filename}
                    </s-text>
                    <s-text variant="bodySm" color="subdued" style={{ display: 'block', marginTop: '0.25rem' }}>
                      Original: {item.originalFilename} • {item.rowCount} rows • {new Date(item.createdAt).toLocaleString()}
                    </s-text>
                  </div>
                  <s-button
                    onClick={() => handleDownloadFromHistory(item.id)}
                    variant="plain"
                    loading={fetcher.state === "submitting"}
                  >
                    Download
                  </s-button>
                </div>
              ))}
            </s-stack>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
