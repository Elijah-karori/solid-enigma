package email

import (
	"bytes"
	"fmt"
	"log"
	"mime"
	"net/smtp"
	"strings"
	"time"
)

// Sender dispatches emails. Implementations: SMTPSender (production) and LogSender (dev).
type Sender interface {
	SendEmail(to []string, subject, body string, isHTML bool) error
}

type SMTPSender struct {
	host, username, password, from string
	port                           int
}

func NewSMTPSender(host string, port int, username, password, from string) *SMTPSender {
	return &SMTPSender{host: host, port: port, username: username, password: password, from: from}
}

// clean strips CR/LF so user-influenced values can never inject extra headers.
func clean(s string) string {
	return strings.NewReplacer("\r", " ", "\n", " ").Replace(strings.TrimSpace(s))
}

func (s *SMTPSender) SendEmail(to []string, subject, body string, isHTML bool) error {
	if len(to) == 0 {
		return fmt.Errorf("no recipients")
	}
	rcpt := make([]string, 0, len(to))
	for _, t := range to {
		if t = clean(t); t != "" {
			rcpt = append(rcpt, t)
		}
	}
	ctype := "text/plain"
	if isHTML {
		ctype = "text/html"
	}
	var msg bytes.Buffer
	fmt.Fprintf(&msg, "From: %s\r\n", clean(s.from))
	fmt.Fprintf(&msg, "To: %s\r\n", strings.Join(rcpt, ", "))
	fmt.Fprintf(&msg, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", clean(subject)))
	fmt.Fprintf(&msg, "Date: %s\r\n", time.Now().Format(time.RFC1123Z))
	msg.WriteString("MIME-Version: 1.0\r\n")
	fmt.Fprintf(&msg, "Content-Type: %s; charset=\"UTF-8\"\r\n\r\n", ctype)
	msg.WriteString(body)

	auth := smtp.PlainAuth("", s.username, s.password, s.host)
	// net/smtp upgrades to STARTTLS automatically on port 587 when the server offers it.
	if err := smtp.SendMail(fmt.Sprintf("%s:%d", s.host, s.port), auth, clean(s.from), rcpt, msg.Bytes()); err != nil {
		return fmt.Errorf("failed to send email: %w", err) // never log credentials
	}
	return nil
}

// LogSender prints emails to the server log (development only: it will print OTP codes).
type LogSender struct{}

func NewLogSender() *LogSender { return &LogSender{} }

func (s *LogSender) SendEmail(to []string, subject, body string, isHTML bool) error {
	log.Printf("--- [EMAIL LOG] to=%s subject=%q html=%v\n%s\n---", strings.Join(to, ", "), subject, isHTML, body)
	return nil
}

// New returns an SMTP sender when fully configured, otherwise the dev log sender.
func New(host string, port int, user, pass, from string) Sender {
	if host == "" || user == "" || pass == "" || from == "" {
		log.Println("SMTP not fully configured - emails (including OTP codes) will be printed to the log. Do not run like this in production.")
		return NewLogSender()
	}
	return NewSMTPSender(host, port, user, pass, from)
}
