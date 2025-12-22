import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");

  await authenticate.admin(request);

  return {};
};

export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { createExport } = await import("../../scripts/create-export");
  const { Buffer } = await import("node:buffer");

  await authenticate.admin(request);

  const formData = await request.formData();
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

  if (result.success && result.buffer) {
    return {
      ...result,
      buffer: Array.from(result.buffer),
    };
  }

  return result;
};

export default function Index() {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [file, setFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(Date.now());

  useEffect(() => {
    if (fetcher.data?.success) {
      const message = `Export created: ${fetcher.data.filename} (${fetcher.data.rowCount} rows)`;

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

      // Clear file input after successful export
      setFile(null);
      setFileInputKey(Date.now());
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
    fetcher.submit(formData, { method: "POST", encType: "multipart/form-data" });
  };

  return (
    <s-page heading="Goossens Product Exporter">
      <s-section heading="Product Export">
        <s-paragraph>
          This application converts and exports product data to Goossens&apos; format.
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
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
