module github.com/org/searc/apps/api-go

go 1.27

require (
    github.com/org/search/gen/go    v0.0.0
)

replace (
    github.com/org/search/gen/go => ../../gen/go
)