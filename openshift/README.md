# OpenShift Deployment

Docker images are automatically built and pushed to GitHub Container Registry (GHCR) via GitHub Actions on every push to `main` and on version tags.

## Prerequisites

- OpenShift CLI (`oc`) installed and configured
- Access to an OpenShift cluster

## Deployment Steps

### 1. Create Project

```powershell
oc new-project redlist-app
```

### 2. Deploy

```powershell
oc process -f openshift/redlistapp.yaml \
  -p NAME=redlist \
  -p APP_IMAGE=ghcr.io/luomus/redlist_evaluation_tool:latest \
  -p POSTGRES_PASSWORD=your-secure-password \
  | oc apply -f -
```

Replace `yourusername` with your GitHub username and `your-secure-password` with a real password

### 3. Wait for Pods to Start

```powershell
oc get pods
```

Wait for both `redlist-db` and `redlist` pods to show "Running" (1-2 minutes).

### 4. Access the Application

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
- `MML_API_KEY`:  Maanmittauslaitos API key used for basemaps
- `TARGET`:  target (system identifier) parameter sent to laji-auth login
- `SECRET_KEY`:   Flask secret key used to sign sessions
- `LAJIAUTH_URL`:  base URL for laji-auth (default: https://fmnh-ws-test-24.it.helsinki.fi/laji-auth/)
- `LAJI_API_BASE_URL`:Base URL for laji.fi API (default: https://api.laji.fi/warehouse/private-query/unit/list)
- `LAJI_API_ACCESS_TOKEN`: Access token for laji.fi API



## Updating the Deployment

1. Make changes to the code locally
2. Commit and push to GitHub:

```powershell
git add .
git commit -m "Your commit message"
git push
```

3. GitHub Actions automatically builds the image and pushes to GHCR
4. Update the OpenShift deployment to pull the latest image:

```powershell
oc rollout restart redlist
```

Or redeploy using a new image tag if you tagged a release version.


