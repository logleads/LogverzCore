package main

//go get -v github.com/pingcap/tidb/types/parser_driver@3a18f1e

import (
	"fmt"
	"os"

	"github.com/pingcap/parser"
	"github.com/pingcap/parser/ast"

	_ "github.com/pingcap/tidb/types/parser_driver"
)

func parse(sql string) (*ast.StmtNode, error) {
	p := parser.New()

	stmtNodes, _, err := p.Parse(sql, "", "")
	if err != nil {
		return nil, err
	}

	return &stmtNodes[0], nil
}

type colX struct {
	TableNames []string
}

func (v *colX) Enter(in ast.Node) (ast.Node, bool) {
	if name, ok := in.(*ast.TableName); ok {
		v.TableNames = append(v.TableNames, name.Name.O)
	}
	return in, false
}

func (v *colX) Leave(in ast.Node) (ast.Node, bool) {
	return in, true
}

func extract(rootNode *ast.StmtNode) []string {
	v := &colX{}
	(*rootNode).Accept(v)
	return v.TableNames
}

func main() {
	if len(os.Args) != 2 {
		fmt.Println("usage: colx 'SQL statement'")
		return
	}
	sql := os.Args[1]
	astNode, err := parse(sql)
	if err != nil {
		fmt.Printf("parse error: %v\n", err.Error())
		return
	}
	fmt.Printf("%v\n", extract(astNode))
}
