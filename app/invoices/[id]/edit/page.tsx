import { InvoiceForm } from "@/app/invoices/InvoiceForm";

export default function EditInvoicePage({ params }: { params: { id: string } }) {
  return <InvoiceForm mode="edit" invoiceId={params.id} />;
}
