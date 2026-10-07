package pdf

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/jung-kurt/gofpdf"
)

type DeliveryNoteItem struct {
	SKU          string
	Model        string
	AssetID      string
	SerialNumber string
	MAC          string
	Quantity     float64
	UnitCost     float64
	TotalCost    float64
}

type DeliveryNoteData struct {
	DocNo       string
	Type        string
	CompanyName string
	Reference   string
	ProjectID   string
	Recipient   string
	CreatedBy   string
	Date        time.Time
	Items       []DeliveryNoteItem
	ShowCosts   bool
	TotalValue  float64
}

func GenerateDeliveryNotePDF(data DeliveryNoteData) (string, error) {
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.AddPage()
	pdf.SetFont("Arial", "B", 18)

	company := data.CompanyName
	if company == "" {
		company = "ONT Network Operations"
	}

	pdf.Cell(190, 10, company)
	pdf.Ln(10)
	pdf.SetFont("Arial", "B", 14)
	docType := data.Type
	if docType == "" {
		docType = "DELIVERY NOTE"
	}
	pdf.Cell(190, 8, fmt.Sprintf("%s - %s", docType, data.DocNo))
	pdf.Ln(10)

	pdf.SetFont("Arial", "", 10)
	pdf.Cell(95, 6, fmt.Sprintf("Date: %s", data.Date.Format("2006-01-02 15:04")))
	pdf.Cell(95, 6, fmt.Sprintf("Reference: %s", data.Reference))
	pdf.Ln(6)
	pdf.Cell(95, 6, fmt.Sprintf("Recipient: %s", data.Recipient))
	pdf.Cell(95, 6, fmt.Sprintf("Project: %s", data.ProjectID))
	pdf.Ln(6)
	pdf.Cell(95, 6, fmt.Sprintf("Issued By: %s", data.CreatedBy))
	pdf.Ln(10)

	pdf.SetFont("Arial", "B", 10)
	pdf.CellFormat(40, 7, "SKU / Model", "1", 0, "", false, 0, "")
	pdf.CellFormat(80, 7, "Asset / Serial / MAC", "1", 0, "", false, 0, "")
	pdf.CellFormat(20, 7, "Qty", "1", 0, "", false, 0, "")
	if data.ShowCosts {
		pdf.CellFormat(25, 7, "Unit (KES)", "1", 0, "", false, 0, "")
		pdf.CellFormat(25, 7, "Total (KES)", "1", 0, "", false, 0, "")
	}
	pdf.Ln(7)
	pdf.SetFont("Arial", "", 9)

	var totalVal float64
	for _, item := range data.Items {
		detail := item.AssetID
		if item.SerialNumber != "" || item.MAC != "" {
			detail = fmt.Sprintf("%s S/N:%s MAC:%s", item.AssetID, item.SerialNumber, item.MAC)
		}
		if detail == "" {
			detail = "-"
		}

		pdf.CellFormat(40, 6, item.SKU, "1", 0, "", false, 0, "")
		pdf.CellFormat(80, 6, detail, "1", 0, "", false, 0, "")
		pdf.CellFormat(20, 6, fmt.Sprintf("%.0f", item.Quantity), "1", 0, "", false, 0, "")
		if data.ShowCosts {
			pdf.CellFormat(25, 6, fmt.Sprintf("%.2f", item.UnitCost), "1", 0, "", false, 0, "")
			pdf.CellFormat(25, 6, fmt.Sprintf("%.2f", item.TotalCost), "1", 0, "", false, 0, "")
			totalVal += item.TotalCost
		}
		pdf.Ln(6)
	}

	if data.ShowCosts {
		pdf.Ln(4)
		pdf.SetFont("Arial", "B", 10)
		pdf.CellFormat(140, 7, "TOTAL VALUE:", "", 0, "R", false, 0, "")
		pdf.CellFormat(50, 7, fmt.Sprintf("KES %.2f", totalVal), "", 0, "", false, 0, "")
		pdf.Ln(10)
	} else {
		pdf.Ln(10)
	}

	pdf.SetFont("Arial", "", 10)
	pdf.CellFormat(95, 20, "Issued By: ___________________", "", 0, "", false, 0, "")
	pdf.CellFormat(95, 20, "Received By: ___________________", "", 0, "", false, 0, "")
	pdf.Ln(15)
	pdf.CellFormat(95, 10, "Date: ________________________", "", 0, "", false, 0, "")
	pdf.CellFormat(95, 10, "Signature / Stamp: ____________", "", 0, "", false, 0, "")

	dir := "storage/delivery_notes"
	_ = os.MkdirAll(dir, 0755)
	filename := fmt.Sprintf("%s.pdf", data.DocNo)
	filePath := filepath.Join(dir, filename)

	if err := pdf.OutputFileAndClose(filePath); err != nil {
		return "", err
	}
	return filePath, nil
}
