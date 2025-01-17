// Licensed to the Apache Software Foundation (ASF) under one or more
// contributor license agreements.  See the NOTICE file distributed with
// this work for additional information regarding copyright ownership.
// The ASF licenses this file to You under the Apache License, Version 2.0
// (the "License"); you may not use this file except in compliance with
// the License.  You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Package containers contains utilities for running test containers in integration tests.
package containers

import (
	"context"
	"testing"

	"github.com/docker/go-connections/nat"
	"github.com/testcontainers/testcontainers-go"
)

type ContainerOptionFn func(*testcontainers.ContainerRequest)

func WithPorts(ports []string) ContainerOptionFn {
	return func(option *testcontainers.ContainerRequest) {
		option.ExposedPorts = ports
	}
}

func NewContainer(
	ctx context.Context,
	t *testing.T,
	image string,
	opts ...ContainerOptionFn,
) testcontainers.Container {
	t.Helper()

	request := testcontainers.ContainerRequest{Image: image}

	for _, opt := range opts {
		opt(&request)
	}

	genericRequest := testcontainers.GenericContainerRequest{
		ContainerRequest: request,
		Started:          true,
	}

	container, err := testcontainers.GenericContainer(ctx, genericRequest)
	if err != nil {
		t.Fatalf("error creating container: %v", err)
	}

	t.Cleanup(func() {
		if err := container.Terminate(ctx); err != nil {
			t.Fatalf("error terminating container: %v", err)
		}
	})

	return container
}

func Port(
	ctx context.Context,
	t *testing.T,
	container testcontainers.Container,
	port nat.Port,
) string {
	t.Helper()

	mappedPort, err := container.MappedPort(ctx, port)
	if err != nil {
		t.Fatalf("error getting mapped port: %v", err)
	}

	return mappedPort.Port()
}
