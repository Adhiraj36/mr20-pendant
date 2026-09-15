// The HTTP API: one Fiber app behind the AWS Lambda Web Adapter.
//
// The adapter translates Function URL invocations (RESPONSE_STREAM mode) into
// plain HTTP against this process, so Fiber serves exactly as it would
// anywhere else — including SSE streaming for /chat — and the binary also
// runs locally with `go run ./cmd/api`.
package main

import (
	"context"
	"log"
	"os"

	"github.com/MelloB1989/mr20-pendant/backend/internal/api"
)

func main() {
	app, err := api.New(context.Background())
	if err != nil {
		log.Fatalf("api init: %v", err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Fatal(app.Listen(":" + port))
}
