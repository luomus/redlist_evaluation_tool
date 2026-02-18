# OpenShift Deployment

## Prerequisites

- OpenShift CLI (`oc`) installed and configured
- Access to an OpenShift cluster
- Docker installed locally
- Docker Hub account

## Deployment Steps

### 1. Build and Push Docker Image

```powershell
docker build -t yourusername/redlist:latest .
docker login
docker push yourusername/redlist:latest
```

Replace `yourusername` with your Docker Hub username.

### 2. Create Project

```powershell
oc new-project redlist-app
```

### 3. Deploy

```powershell
oc process -f openshift\redlistapp.yaml \
  -p NAME=redlist \
  -p APP_IMAGE=yourusername/redlist:latest \
  -p POSTGRES_PASSWORD=your-secure-password \
  | oc apply -f -
```

### 4. Wait for Pods to Start

```powershell
oc get pods
```

Wait for both `redlist-db` and `redlist` pods to show "Running" (1-2 minutes).

### 6. Access the Application

```powershell
oc get route redlist
```

Open the URL in your browser.

## Template Parameters

Edit `redlistapp.yaml` to customize:
- `NAME`: Resource name prefix
- `APP_IMAGE`: Docker image URL
- `POSTGRES_PASSWORD`: Database password
- `VOLUME_CAPACITY`: Database storage size (default: 1Gi)
